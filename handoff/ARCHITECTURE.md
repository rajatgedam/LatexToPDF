# Architecture (source of truth)

If code and this file disagree, fix one of them in the same commit. Last verified: 2026-10-29 (v0.3.0: engine catalog, isolated workers, MCP, packs, lite bundles; macOS arm64, CI covers Linux).

## Goal

ToolMaster is a **menu of small local tools**. One kernel (`core/`) runs any number of independent tools (`tools/<id>/`) and exposes them five ways:

| Entry point | Audience | Command |
| --- | --- | --- |
| Web app (start menu, then a workbench per tool) | Humans | `node bin/toolmaster.mjs ui` |
| Terminal menu (no arguments, interactive) | Humans | `node bin/toolmaster.mjs` |
| CLI | Agents / scripts | `node bin/toolmaster.mjs <tool> -i in -o out|- --json` |
| MCP server (stdio) | AI agents / IDEs | `node bin/toolmaster.mjs mcp` |
| Node API / HTTP API | Other programs | `createToolMaster()`, `POST /api/tools/:id/run` |

Tools today: `latex-to-pdf`, `latex-to-docx`, `pdf-pages`, `doc-to-markdown` (catalog: `TOOLS.md`, generated).

## Design rules (keep these true)

1. **Tools depend on the core SDK only** (`core/sdk.mjs`). They never import each other, the engine catalog or other core modules.
2. **The core never imports a tool or an engine spec statically.** It discovers `tools/*/tool.mjs` and `engines/*.mjs` at runtime (source) or receives generated static lists (bundles). Deleting a tool folder removes the tool, its tests and its download.
3. **Everything tool-specific is declared in the manifest** (inputs, outputs, options, engines by id, preview kind, UI wording, sample, `useWhen`). The CLI, HTTP API, MCP server, web UI and `TOOLS.md` all render from it, so a new tool needs no core, UI or doc change.
4. **Engines are shared.** A tool names the programs it needs by id (`engines: ["pandoc"]`); the spec (pinned URLs + SHA-256, licence) lives once in `engines/<id>.mjs`. Two tools using Pandoc share one download, one pack and one licence notice.
5. **Untrusted input is only touched in a separate process, through one hardened path** (`core/process.mjs`): `ctx.exec` for external programs, `ctx.isolate` for JavaScript parsers (a sandboxed copy of this same program running `tool.workers[job]`). A tool never calls `child_process` itself and never parses an untrusted file in the host process.
6. **Security is layered**: the core validates sizes/options/concurrency; the tool validates its format; the process layer isolates (temp dir, scrubbed env, timeout kill, heap limit, caps); the OS sandbox (macOS) backs it up; MCP confines file paths.
7. **Size does not grow with the number of tools**: bundles contain only the chosen tools, engines and libraries; engines ship Brotli-compressed; engine-free tools add well under 1 MB (see `RESEARCH.md`).

## Technology decisions

| Concern | Choice | Why | Rejected |
| --- | --- | --- | --- |
| Backend | Node.js >= 22.13, ESM, no runtime dependencies in the core | Smallest supply-chain surface; `node:http`, `node:test`, `node:zlib` suffice | Express/Fastify |
| JS libraries | `@cantoo/pdf-lib` (MIT, maintained fork of pdf-lib) and `pdfjs-dist` (Apache-2.0), pinned exactly, bundled by esbuild only into bundles whose tools use them, run only inside workers | Page editing and text extraction with no native code; 0.6 MB and 1.7 MB minified | `pdf-lib` (unmaintained since 2022), poppler/qpdf (GPL/native binaries), Python |
| LaTeX to PDF engine | [Tectonic](https://github.com/tectonic-typesetting/tectonic) 0.17.0 (MIT) | Self-contained, no TeX Live (4+ GB) | TeX Live, WASM engines |
| Documents engine | [Pandoc](https://pandoc.org) 3.13 (GPL-2.0-or-later) | One reader for docx, pptx, xlsx, odt, epub, html, rtf, csv, latex...; built-in `--sandbox` | LibreOffice (huge), per-format JS libraries |
| Agent protocol | MCP over stdio, written by hand (about 200 lines), generated from manifests | The standard way IDE agents discover tools; no SDK dependency | A bespoke JSON-RPC, a hosted API |
| Frontend | Vite + React 19 + TypeScript, Vitest + Testing Library, hash routing | Static build served by the backend | Next.js |
| Packaging | Node SEA single executable (esbuild bundle + postject) **or** lite (`toolmaster.cjs` + Node), engines as Brotli packs | Portable with or without Node; see sizes in README | Electron, Tauri, Bun/Deno compile (not evaluated beyond research) |
| Compression at rest | Brotli quality 11 for releases (7 locally) | Stable in `node:zlib`; 24 MB vs 41 MB (gzip) for Pandoc. zstd is smaller than gzip too but experimental in Node | UPX (breaks signing, antivirus flags), zip-only |

Engines are never committed. `toolmaster install` downloads each pinned release asset, verifies its **SHA-256 before extraction** and keeps only the binary in `vendor/<engine-id>/`. Release bundles carry `vendor/<id>.pack` instead and unpack on first use.

## Module map

```
bin/toolmaster.mjs           entry: runCli(argv) then finish(result)
engines/<id>.mjs             engine specs: id, binary, versionArgs, per-platform URL + sha256, licence, homepage
core/
  index.mjs                  createToolMaster({env, projectRoot, tools, engines, self}) -> { config, registry, engines, runner }
  sdk.mjs                    defineTool, ToolMasterError (the ONLY module tools import)
  manifest.mjs               validateManifest, validateEngineSpec (fail fast with TOOL_INVALID)
  registry.mjs               createRegistry, discoverTools(toolsDir, {only})
  engine-catalog.mjs         createEngineCatalog (get/forManifest/forManifests), discoverEngines(dir)
  runner.mjs                 createRunner: run/preview/runToFile/runFromSource/status/warmup; ctx (exec, isolate, engine, cacheDir)
  process.mjs                runProcess: temp dir, files in/out, scrubbed env, timeout+kill, caps, sandbox (rw + ro folders)
  worker.mjs, worker-entry.mjs   child side of ctx.isolate: run tool.workers[job], write result.json
  engines.mjs                resolveEngine (override > vendor/<id> after unpacking vendor/<id>.pack > PATH), engineInfo
  pack.mjs                   createPack/extractPack/ensureUnpacked: Brotli container, per-file SHA-256, path-traversal checks, atomic
  installer.mjs              assetFor, assertSha256, installEngine
  sandbox.mjs                macOS Seatbelt profile builder (+ read-only folders and metadata-only ancestors)
  mcp.mjs                    MCP server: initialize, ping, tools/list, tools/call, cancel; allowedRoots/confine
  catalog.mjs                renderCatalog -> TOOLS.md
  config.mjs                 TOOLMASTER_* env -> validated frozen config (+ self, packDir, SOURCE_ROOT)
  version.mjs                VERSION (a test keeps it equal to package.json)
  errors.mjs, limiter.mjs
  cli/{index,menu,main}.mjs  commands, interactive menu, finish()
  server/*.mjs               app, security, rate-limit, body, static, index, launch
  portable.mjs               entry of the single-file builds (also answers `__worker`)
tools/<id>/
  tool.mjs                   default export defineTool({ manifest, run, preview?, warmup?, workers? })
  <helpers>.mjs, sample.mjs
  test/unit, test/integration
web/                         React app: Home (menu) + Workbench (any tool) from GET /api/tools
scripts/                     build-portable, build-lib, plan-release/plan-lib, smoke-bundle, smoke-http, gen-catalog
test/helpers, test/fixtures  fake engines, fake tools, test server, sample.pdf
```

## Tool contract

```js
defineTool({
  manifest: {
    id, name, description, useWhen?, category, icon, tags?, version?,
    input:  { kind: "text" | "binary", accept: [".ext"], maxBytes? },
    output: { contentType, extension },
    preview: "file" | "html" | "text" | "none",   // file: the output is previewable (PDF); html: preview() renders a locked-down page; text: the UI shows the text + Copy
    options: [{ id, label, type: "enum" | "boolean" | "string", values?, maxLength?, help?, default }],
    engines: ["pandoc"],                           // catalog ids (an inline spec object is also accepted)
    ui: { action: "Compile" },
    sample?: "known-good input",
  },
  run(ctx, { input, options }) -> { data: Buffer, meta?: {}, warnings?: [] },
  preview?(ctx, { input, options }) -> { data, contentType },   // iff preview === "html"
  warmup?(ctx),                                                  // prime caches for offline use
  workers?: { [job]: async ({ dir }) => result },                // code that parses untrusted files (child process only)
});
```

`ctx`: `config`, `signal`, `timeoutMs`, `limits`, `engine(id)`, `cacheDir(name)` (async; unpacks a shipped cache pack first),

```js
ctx.exec({ engine, files, outputs, args | (dir) => args, env?, rw?, network?, errorPattern?, label? })
  -> { outputs, log, code }
ctx.isolate({ job, request?, files?, outputs?, heapMb? })     // runs tool.workers[job] in a sandboxed child (no network, scrubbed env, heap limit)
  -> { result, outputs, log }                                  // worker errors keep their ToolMasterError code (e.g. INPUT_INVALID)
```

Worker protocol: the child is started as `<self.command> <self.args...> <toolId> <job>` in an empty work folder containing `request.json` and the given files; it writes `result.json` (`{ result }` or `{ error: { code, message } }`) and any declared outputs. `self` is the executable itself (`__worker` argument), `node toolmaster.cjs __worker`, or `node core/worker-entry.mjs` from source. A crash, OOM or timeout is `TOOL_FAILED`/`TIMEOUT`.

The runner validates **before** the tool runs: tool exists, options (unknown/invalid -> `INPUT_INVALID`; strings are trimmed and length-limited), input type, size, NUL bytes, emptiness; then takes a concurrency slot (`BUSY`), calls the tool, checks the output size.

Conventions: engine id == cache folder name (`vendor/cache/<engine-id>`); manifest `id` == folder name; errors from tools should be `ToolMasterError`.

## Adding a tool (checklist)

1. `tools/<id>/tool.mjs` with `defineTool`; keep helpers inside the folder. Give it a `useWhen` sentence and tags (a test requires both).
2. External program: add `engines/<id>.mjs` (pinned URLs and SHA-256 written to a file from the release metadata and read back, licence, homepage), list the id in `engines`, run via `ctx.exec` (`network: false` unless needed). JavaScript parser of untrusted files: implement it under `workers` and call `ctx.isolate`; import heavy libraries lazily inside the worker.
3. Validate the format in the tool; prefer an engine's own sandbox flag.
4. Tests first: hermetic unit tests (fake engines in `test/helpers`), integration tests with real engines/libraries (skipped when an engine is missing).
5. Add a case for the tool in `scripts/smoke-bundle.mjs` and `scripts/smoke-http.mjs` (a test fails until you do), run `npm run catalog`, `npm test`.
6. The web app, CLI, HTTP catalog, MCP and packaging pick it up automatically. Update `handoff/PROGRESS.md`, and this file only if the contract changed.

## Public surfaces

**CLI**: no args in a terminal -> interactive menu, otherwise help. Commands: `ui [--no-open]`, `list [--json]`, `run <tool> ...` or `<tool> ...`, `help [tool] [--json]`, `sample <tool>`, `mcp`, `install [tool...] [--force]`, `doctor [--json]`, `warmup [tool...]`; the hidden `__worker` belongs to `ctx.isolate`. Run flags: `-i`, `-o` (`-` = stdout for text outputs), `-O key=value`, `--mkdir`, `--timeout`, `--json`. Exit codes: `0` ok, `1` unexpected, `2` bad usage/input/output path/config/unknown tool, `3` policy violation, `4` tool failed or output too large, `5` timeout, `6` engine missing, `7` busy.

**MCP** (`toolmaster mcp`, newline-delimited JSON-RPC 2.0 on stdio; protocol versions 2025-06-18, 2025-03-26, 2024-11-05): one MCP tool per manifest. Input schema: `input_path`, `input_text` (text tools), `output_path`, plus options typed from the manifest (`enum`, `boolean`, `string` with `maxLength`); `additionalProperties: false`. Results: a JSON summary block and, for text outputs without `output_path`, the text as a second block (truncated at 200,000 characters with a note); binary outputs without `output_path` go to `<tmp>/toolmaster-mcp/<tool>-*/output.<ext>`. Failures are `isError: true` results (code + log tail), unknown tools are JSON-RPC `-32602`. `notifications/cancelled` aborts a running call. Paths are resolved with `realpath` (nearest existing ancestor for new files) and must stay inside `TOOLMASTER_MCP_ROOTS` (default: working folder + temp folder).

**Node API**: `createToolMaster()` -> `runner.run(id, {input, options, signal, timeoutMs})`, `runner.preview(...)`, `runner.runToFile({tool, input|source, output, options, mkdir, signal})`, `runner.runFromSource({tool, input|source, options})`, `runner.status()`, `runner.warmup(id)`. Errors: `ToolMasterError` codes `CONFIG_INVALID, INPUT_EMPTY, INPUT_TOO_LARGE, INPUT_INVALID, POLICY_VIOLATION, TOOL_NOT_FOUND, TOOL_INVALID, ENGINE_NOT_FOUND, TOOL_FAILED, TIMEOUT, OUTPUT_TOO_LARGE, OUTPUT_PATH_INVALID, BUSY`.

**HTTP** (default `127.0.0.1:5757`, falls back to a free port when busy and unset):
- `GET /api/health` -> `{ ok, tools: { id: { ready, engines: [{id, found, version?}] } } }` (cached 30 s, no paths; a packed engine reports "bundled (unpacks on first use)")
- `GET /api/tools` -> `{ tools: [public manifest fields + status] }` (adds `useWhen`; never `engines`)
- `POST /api/tools/:id/run` and `/preview`: text tools take `application/json {input, options}` or a raw `text/*`/`application/x-tex` body with options in the query; binary tools take `application/octet-stream` with options in the query. Returns the file (`X-ToolMaster-Duration-Ms`, `X-ToolMaster-Meta` JSON, `X-ToolMaster-Warnings` count; `inline` disposition only for `preview: "file"` tools) or `{ error: { code, message, log? } }`. Status map: 400 empty/invalid input, 404 unknown tool, 413 too large, 415 media type, 422 policy/tool failure/output too large, 429 rate limit, 503 busy/engine missing (`Retry-After` on busy), 504 timeout, 403 Host/Origin, 500 generic `INTERNAL`. A client disconnect aborts the job.
- everything else: static `web/dist` (GET/HEAD only).

**Web app**: hash routes `#/` (menu: search, categories, cards, keys `/` and `1-9`) and `#/tool/<id>` (workbench: options bar with select/checkbox/text controls, auto-run for text tools, editor or file drop, result pane with `file`/`html`/`text`/`none` preview, download named after the source file).

## Configuration (env vars, all optional)

| Var | Default | Meaning |
| --- | --- | --- |
| `TOOLMASTER_PORT` / `_HOST` | `5757` / `127.0.0.1` | server bind; non-loopback needs `TOOLMASTER_ALLOW_REMOTE=1` (+ `TOOLMASTER_ALLOWED_HOSTS`) |
| `TOOLMASTER_TOOLS` | all found | comma list of enabled tool ids |
| `TOOLMASTER_MAX_INPUT_BYTES` / `_MAX_OUTPUT_BYTES` | 1 MiB / 25 MiB | size caps (manifest `input.maxBytes` overrides the input cap; PDF/document tools use 25 MiB) |
| `TOOLMASTER_TIMEOUT_MS` | 60000 | per-job timeout |
| `TOOLMASTER_MAX_CONCURRENCY` | 2 | parallel jobs; extras get `BUSY` |
| `TOOLMASTER_RATE_LIMIT_PER_MIN` | 60 | per-IP HTTP limit |
| `TOOLMASTER_OFFLINE` | 0 | tools that can use the network must not (Tectonic `--only-cached`) |
| `TOOLMASTER_SANDBOX` | auto | `auto`/`on`/`off` OS sandbox for engines and workers |
| `TOOLMASTER_ENGINE_<ID>` | auto | explicit engine binary path (id upper-cased, `-` -> `_`) |
| `TOOLMASTER_VENDOR_DIR` | `<root>/vendor` | where engines are installed/unpacked (share between downloads); packs are always read from `<root>/vendor` |
| `TOOLMASTER_CACHE_DIR` | `<vendor>/cache` | engine caches |
| `TOOLMASTER_MCP_ROOTS` | cwd + temp dir | folders the MCP server may touch (path-delimited) |

## Packaging and distribution

`npm run package -- --tools all|a,b [--runtime sea|node] [--engines bundled|download] [--no-cache] [--no-pack] [--pack-quality 0-11] [--zip] [--out dir]`

- A generated entry imports **only** the chosen tools and the engines they name; esbuild bundles them (and only the libraries they import, found via the metafile) into one minified CJS file.
- `--runtime sea` (default): Node SEA executable (macOS: thinned, ad-hoc signed); `--runtime node`: `toolmaster.cjs` + `toolmaster`/`toolmaster.cmd` launchers, needs Node 22.13+. Folder names: `ToolMaster-<bundle>-<os>-<arch>`, `ToolMaster-<bundle>-lite-<os>-<arch>`, and `ToolMaster-<tool>-lite` (no engines: identical on every OS).
- Engines and warmed caches are Brotli packs (`vendor/<id>.pack`, `vendor/cache/<id>.pack`) unless `--no-pack`; `--engines download` ships none.
- `THIRD-PARTY-NOTICES.txt` lists every engine (with source location, Pandoc is GPL) and every bundled JavaScript package with its licence text; `READ-ME-FIRST.txt` states runtime and engine facts truthfully.
- Docker: multi-stage, digest-pinned `node:24-slim` + `ca-certificates`; builds the lite bundle with `--no-pack` (no node_modules, no sources in the image), non-root, healthcheck. `--build-arg TOOLS=a,b`. Images: `toolmaster` and `toolmaster-<tool-id>` (multi-arch).
- CI (`ci.yml`): tests on ubuntu + macOS with the 80% coverage gate, `npm audit`, catalog drift check, lite-bundle smoke test, Docker smoke tests (`scripts/smoke-http.mjs`, every tool over HTTP). Release (`release.yml`): `plan` job builds the matrix (`scripts/plan-lib.mjs`): per OS an all-in-one executable (+ per tool and a lite all-in-one on tags), once the engine-free lite bundles; each bundle is smoke-tested offline (`scripts/smoke-bundle.mjs`, includes MCP); SHA256SUMS, attestations, GitHub release, multi-arch images. A manual run builds only the all-in-one per OS unless "full" is ticked. Pages (`pages.yml`): static landing page in `site/`.
- Sizes: see `README.md` and `RESEARCH.md`.

## Constraints worth remembering

- Tectonic is XeTeX: pdfTeX-only primitives are undefined; `tools/latex-to-pdf/compat.mjs` strips common whole-line ones (reported as `compat:` warnings).
- `tectonic --untrusted` still allows absolute-path `\input`; the policy scan (`validate.mjs`) is the file-read barrier there. Pandoc's `--sandbox` blocks file/network/process access from documents.
- DOCX is structure-faithful, not layout-faithful. Doc to Markdown has no OCR (scanned PDFs warn), no CJK character maps, and pdf.js image decoders that need WASM are unused (text only).
- `pdf-pages` rebuilds the document from copied pages: title/author/subject are kept; bookmarks, forms and link annotations are not. Password-protected PDFs are refused, never bypassed.
- The macOS sandbox profile denies reads under `/Users` etc. and re-allows the work folder, the program's own folder and read-only folders; parent folders get metadata-only access because Node `lstat`s every path component.
- Node's permission model is a seat belt, not a sandbox against malicious code (Node docs), so it is not used as a security boundary here.
- Measured: cold LaTeX to PDF ~11 s (package download), warm ~0.5 s; LaTeX to DOCX ~0.3 s; PDF tools ~0.4 s per call (process start included).
