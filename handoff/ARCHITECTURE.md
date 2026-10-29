# Architecture (source of truth)

If code and this file disagree, fix one of them in the same commit. Last verified: 2026-10-29 (ToolMaster modular refactor, macOS arm64; CI covers Linux).

## Goal

ToolMaster is a **menu of small local tools**. One kernel (`core/`) runs any number of independent tools (`tools/<id>/`) and exposes them four ways:

| Entry point | Audience | Command |
| --- | --- | --- |
| Web app (start menu, then a workbench per tool) | Humans | `node bin/toolmaster.mjs ui` |
| Terminal menu (no arguments, interactive) | Humans | `node bin/toolmaster.mjs` |
| CLI | Agents / scripts | `node bin/toolmaster.mjs <tool> -i in -o out --json` |
| Node API / HTTP API | Agents / other programs | `createToolMaster()`, `POST /api/tools/:id/run` |

## Design rules (keep these true)

1. **Tools depend on the core SDK only** (`core/sdk.mjs`). They never import each other and never import other core modules.
2. **The core never imports a tool statically.** It discovers `tools/*/tool.mjs` at runtime (source/Docker) or receives a generated static list (single-file executable). Deleting a tool folder removes the tool, its engine requirement, its tests and (via packaging) its download.
3. **Everything tool-specific is declared in the manifest** (inputs, outputs, options, engines, preview kind, UI wording, sample). The CLI, HTTP API and web UI render from it, so a new tool needs no core or UI change.
4. **External programs run through one hardened path** (`ctx.exec` -> `core/process.mjs` -> `core/sandbox.mjs`). A tool never calls `child_process` itself.
5. **Security is layered**: core validates input size/options/concurrency; the tool validates its own format; the process layer isolates; the OS sandbox (macOS) backs it up.

## Technology decisions

| Concern | Choice | Why | Rejected |
| --- | --- | --- | --- |
| Backend | Node.js >= 22, ESM, **zero runtime npm dependencies** | Smallest supply-chain surface; `node:http`, `node:test`, `node:child_process` suffice | Express/Fastify |
| LaTeX to PDF engine | [Tectonic](https://github.com/tectonic-typesetting/tectonic) 0.17.0 (MIT) | Self-contained, no TeX Live (4+ GB), never prompts, local package cache | TeX Live/MacTeX, `brew install tectonic` (22 deps), WASM engines |
| LaTeX to DOCX engine | [Pandoc](https://pandoc.org) 3.13 (GPL-2.0-or-later) | The standard LaTeX reader/DOCX writer; built-in `--sandbox` blocks file/network/process access | Hand-rolled converter, PDF-to-DOCX (poor), LibreOffice (huge) |
| Frontend | Vite + React 19 + TypeScript, Vitest + Testing Library, hash routing | Static build served by the backend; no router dependency | Next.js |
| Packaging | Node SEA single-file launcher (esbuild bundle + postject) + `vendor/` + `web/dist` | Portable, no Node needed on the target | Electron, Tauri |

Engines are never committed. `toolmaster install` downloads each pinned release asset, verifies its **SHA-256 before extraction**, and keeps only the binary in `vendor/<engine-id>/`.

## Module map

```
bin/toolmaster.mjs           entry: runCli(argv) then finish(result)
core/
  index.mjs                  createToolMaster({env, projectRoot, tools}) -> { config, registry, runner }
  sdk.mjs                    defineTool, ToolMasterError (the ONLY module tools import)
  manifest.mjs               validateManifest, validateEngineSpec (fail fast with TOOL_INVALID)
  registry.mjs               createRegistry (list/get/has), discoverTools(toolsDir, {only})
  runner.mjs                 createRunner: run/preview/runToFile/status/warmup; option+input validation, limits, BUSY
  process.mjs                runProcess: temp dir, files in/out, scrubbed env, timeout+kill, log/size caps, sandbox
  engines.mjs                resolveEngine (override > vendor/<id> > PATH), engineInfo (version, no paths exposed)
  installer.mjs              assetFor, assertSha256, installEngine (verify, extract binary, check it runs)
  sandbox.mjs                macOS Seatbelt profile builder + wrapWithSandbox (paths passed as -D params)
  config.mjs                 TOOLMASTER_* env -> validated frozen config
  errors.mjs                 ToolMasterError + stable codes
  limiter.mjs                non-blocking concurrency limiter
  cli/index.mjs              commands: menu, ui, list, run/<tool>, help, sample, install, doctor, warmup
  cli/menu.mjs               interactive terminal menu (injectable IO, testable)
  cli/main.mjs               finish(): exit code or keep the server alive until a signal
  server/app.mjs             routes, Host/Origin checks, rate limit, headers; listen() with port fallback
  server/{security,rate-limit,body,static,index,launch}.mjs
  portable.mjs               single-file executable entry (projectRoot = folder of the binary, bundled tools)
tools/<id>/
  tool.mjs                   default export defineTool({ manifest, run, preview?, warmup? })
  engine.mjs                 engine spec(s): id, binary, versionArgs, per-platform URL + sha256, licence
  sample.mjs                 known-good input (served by `toolmaster sample`, `/api/tools`, "Load sample")
  <tool helpers>.mjs         latex-to-pdf: input, compat, validate, pdf; latex-to-docx: preview
  test/unit, test/integration
web/                         React app: Home (menu) + Workbench (any tool) from GET /api/tools
scripts/                     build-portable (--tools), build-lib, prune-tools
test/helpers/                fake engines (tectonic-like, pandoc-like), fake tools, test server
```

## Tool contract

```js
defineTool({
  manifest: {
    id, name, description, category, icon, tags?, version?,
    input:  { kind: "text" | "binary", accept: [".ext"], maxBytes? },   // maxBytes overrides TOOLMASTER_MAX_INPUT_BYTES
    output: { contentType, extension },
    preview: "file" | "html" | "none",     // file: output itself is previewable (PDF); html: preview() renders a locked-down page
    options: [{ id, label, type: "enum" | "boolean", values?, default }],
    engines: [engineSpec],                  // external programs the tool needs
    ui: { action: "Compile" },              // button label
    sample?: "known-good input",
  },
  run(ctx, { input, options }) -> { data: Buffer, meta?: {}, warnings?: [] },
  preview?(ctx, { input, options }) -> { data: Buffer, contentType },   // required iff preview === "html"
  warmup?(ctx) -> Promise<void>,            // prime caches so the tool works offline
});
```

`ctx` (built per call by the runner): `config`, `signal` (abort), `timeoutMs`, `limits {maxInputBytes, maxOutputBytes}`, `engine(id)` (resolved path), `cacheDir(name)` (= `vendor/cache/<name>`), and

```js
ctx.exec({ engine, files: {name: content}, outputs: [names], args: [..] | (dir) => [..],
           env?, rw?: [dirs], network?: boolean, errorPattern?, label? })
  -> { outputs: {name: Buffer}, log, code }     // throws TOOL_FAILED / TIMEOUT / OUTPUT_TOO_LARGE / ENGINE_NOT_FOUND
```

The runner validates **before** the tool runs: tool exists, options (unknown/invalid -> `INPUT_INVALID`), input type, size, NUL bytes, emptiness; then it takes a concurrency slot (`BUSY`), calls the tool, and checks the output size.

Conventions: engine id == cache folder name (`vendor/cache/<engine-id>`); the manifest `id` equals the folder name; errors thrown by tools should be `ToolMasterError` (anything else becomes a generic 500 over HTTP).

## Adding a tool (checklist)

1. `tools/<id>/tool.mjs` with `defineTool`; keep all helpers inside the folder.
2. If it needs a program: `engine.mjs` with pinned per-platform URLs and SHA-256 (write digests to a file from the release metadata and read them back; never trust a copied/summarized hash), licence and homepage. Run it only through `ctx.exec`; pass `network: false` unless it truly needs the network.
3. Validate its own format in the tool (the core only checks generic input rules). Prefer an engine's own sandbox flag (like Pandoc `--sandbox`) plus a policy scan where the format can reach files or processes.
4. Tests first in `tools/<id>/test/unit` (hermetic, fake engine from `test/helpers`) and `test/integration` (real engine, skipped when the engine is missing).
5. `node bin/toolmaster.mjs install <id>`, then `npm test`. The web app, CLI help, HTTP catalog and packaging pick the tool up automatically; no core or `web/` change is needed. Add the id to the release/CI bundle lists only if you want a dedicated download (`.github/workflows/release.yml`).
6. Update `README.md` tool table, `handoff/PROGRESS.md`, and this file if the contract changed.

## Public surfaces

**CLI** (`toolmaster`): no args in a terminal -> interactive menu, otherwise help. Commands: `ui [--no-open]`, `list [--json]`, `run <tool> ...` or `<tool> ...`, `help [tool]`, `sample <tool>`, `install [tool...] [--force]`, `doctor [--json]`, `warmup [tool...]`. Run flags: `-i`, `-o`, `-O key=value` (repeatable), `--mkdir`, `--timeout`, `--json`. Exit codes: `0` ok, `1` unexpected, `2` bad usage/input/output path/config/unknown tool, `3` policy violation, `4` tool failed or output too large, `5` timeout, `6` engine missing, `7` busy.

**Node API**: `createToolMaster()` -> `runner.run(id, {input, options, signal, timeoutMs})`, `runner.preview(...)`, `runner.runToFile({tool, input|source, output, options, mkdir})`, `runner.status()`, `runner.warmup(id)`. Errors: `ToolMasterError` codes `CONFIG_INVALID, INPUT_EMPTY, INPUT_TOO_LARGE, INPUT_INVALID, POLICY_VIOLATION, TOOL_NOT_FOUND, TOOL_INVALID, ENGINE_NOT_FOUND, TOOL_FAILED, TIMEOUT, OUTPUT_TOO_LARGE, OUTPUT_PATH_INVALID, BUSY`.

**HTTP** (default `127.0.0.1:5757`, falls back to a free port when busy and unset):
- `GET /api/health` -> `{ ok, tools: { id: { ready, engines: [{id, found, version?}] } } }` (cached 30 s, no paths)
- `GET /api/tools` -> `{ tools: [manifest-without-engines + status] }`
- `POST /api/tools/:id/run` and `/preview`: text tools take `application/json {input, options}` or a raw `text/*`/`application/x-tex` body with options in the query; binary tools take `application/octet-stream`. Returns the file (`X-ToolMaster-Duration-Ms`, `X-ToolMaster-Meta` JSON, `X-ToolMaster-Warnings` count; `inline` disposition only for `preview: "file"` tools) or `{ error: { code, message, log? } }`. Status map: 400 empty/invalid input, 404 unknown tool, 413 too large, 415 media type, 422 policy/tool failure/output too large, 429 rate limit, 503 busy/engine missing (`Retry-After` on busy), 504 timeout, 403 Host/Origin, 500 generic `INTERNAL`. A client disconnect aborts the job.
- everything else: static `web/dist` (extensionless paths fall back to `index.html`; 503 with a hint if not built), GET/HEAD only.

**Web app**: hash routes `#/` (menu: search, categories, cards, keys `/` and `1-9`) and `#/tool/<id>` (workbench: options bar, auto-run for text tools, editor or file drop, result pane with `file`/`html`/`none` preview, download named after the source file). Preview iframes: `file` -> blob PDF viewer; `html` -> `sandbox=""` blob page with its own CSP.

## Configuration (env vars, all optional)

| Var | Default | Meaning |
| --- | --- | --- |
| `TOOLMASTER_PORT` / `_HOST` | `5757` / `127.0.0.1` | server bind; non-loopback needs `TOOLMASTER_ALLOW_REMOTE=1` (+ `TOOLMASTER_ALLOWED_HOSTS`) |
| `TOOLMASTER_TOOLS` | all found | comma list of enabled tool ids |
| `TOOLMASTER_MAX_INPUT_BYTES` / `_MAX_OUTPUT_BYTES` | 1 MiB / 25 MiB | size caps (manifest `input.maxBytes` overrides the input cap) |
| `TOOLMASTER_TIMEOUT_MS` | 60000 | per-job timeout |
| `TOOLMASTER_MAX_CONCURRENCY` | 2 | parallel jobs; extras get `BUSY` |
| `TOOLMASTER_RATE_LIMIT_PER_MIN` | 60 | per-IP HTTP limit |
| `TOOLMASTER_OFFLINE` | 0 | tools that can use the network must not (Tectonic `--only-cached`) |
| `TOOLMASTER_SANDBOX` | auto | `auto`/`on`/`off` OS sandbox for engines |
| `TOOLMASTER_ENGINE_<ID>` | auto | explicit engine binary path (id upper-cased, `-` -> `_`) |
| `TOOLMASTER_CACHE_DIR` | `<root>/vendor/cache` | engine caches |

## Packaging and distribution

- `npm run package -- --tools all|a,b [--no-cache] [--zip]` -> `dist/ToolMaster-<bundle>-<os>-<arch>/`: `toolmaster` single-file launcher (generated entry imports **only** the chosen tools; esbuild minified CJS inside a Node SEA; macOS: thin the universal node, ad-hoc codesign), `vendor/<engine>` and `vendor/cache/<engine>` for the chosen tools only, `web/dist`, `ToolMaster.command|.sh|.bat`, `LICENSE`, `THIRD-PARTY-NOTICES.txt` (generated from the engine specs; Pandoc is GPL so the source location is stated), `READ-ME-FIRST.txt`. The executable resolves everything relative to its own folder.
- Measured (macOS arm64, zip / unpacked): all 107 / 394 MB, DOCX only 76 / 298 MB, PDF only 66 / 207 MB (launcher 111 MB, Pandoc ~190 MB, Tectonic 54 MB + 45 MB cache).
- Docker: multi-stage, digest-pinned `node:24-slim` + `ca-certificates` (Tectonic panics without a CA bundle), `ARG TOOLS` prunes tool folders (`scripts/prune-tools.mjs`) before `toolmaster install` + `warmup`, non-root, healthcheck. Images: `toolmaster`, `toolmaster-latex-to-pdf`, `toolmaster-latex-to-docx` (multi-arch).
- CI (`ci.yml`): tests on ubuntu + macOS, `npm audit`, Docker smoke tests (all tools, and one tool only: the catalog must list exactly that tool). Release (`release.yml`, tag `v*`): 5 OS targets x 3 bundles, offline smoke test of every bundle, SHA256SUMS + attestations, GitHub release, multi-arch images. Manual run = dry run. Pages (`pages.yml`): static landing page in `site/`.

## Constraints worth remembering

- Tectonic is XeTeX: pdfTeX-only primitives are undefined; `tools/latex-to-pdf/compat.mjs` strips common whole-line ones (reported as `compat:` warnings).
- `tectonic --untrusted` still allows absolute-path `\input`; the policy scan (`validate.mjs`) is the file-read barrier there. Pandoc's `--sandbox` blocks file/network/process access from documents.
- Pandoc errors on unbalanced LaTeX (`unexpected end of input`); that is surfaced as `TOOL_FAILED` with its message.
- DOCX is structure-faithful, not layout-faithful: custom resume macros and spacing commands do not translate.
- Measured: cold LaTeX to PDF ~11 s (package download), warm ~0.5 s; LaTeX to DOCX ~0.3 s.
- Tectonic needs a CA bundle at startup even for cached runs.
