# Handoff 2026-10-29 (session 3: scale-out overhaul, v0.3.0)

Read in this order: `ARCHITECTURE.md` (truth), `SECURITY_RULES.md`, `RESEARCH.md` (why), `PROGRESS.md`, this file, `AGENTS.md` and `TOOLS.md` (agent-facing), `DESIGN_LANGUAGE.md` (UI work only). `HANDOFF_2026-10-29.md` (refactor session) and `HANDOFF_2026-10-28.md` are history.

## What changed
Goal of the session: keep size flat while adding ten more tools later, research how others do it, add two tools, make agents use tools instead of runtime scripts, clean up.
- **Shared engine catalog** `engines/<id>.mjs`; manifests say `engines: ["pandoc"]`.
- **Compressed packs** for engines and caches (Brotli), unpacked on first use: Pandoc 186 -> 24 MB, Tectonic 52 -> 13 MB, cache 44 -> 6 MB.
- **Isolated workers** (`ctx.isolate`, `tool.workers`): JavaScript parsers run in a sandboxed child process of the same program.
- **MCP server** `toolmaster mcp`, `-o -` stdout, `help --json`, `AGENTS.md`, generated `TOOLS.md`, `.vscode/mcp.json`.
- **New tools**: `pdf-pages` (pick/reorder/reverse/repeat/delete/rotate pages), `doc-to-markdown` (PDF, DOCX, PPTX, XLSX, ODT, EPUB, RTF, HTML, CSV... to Markdown).
- **Packaging**: `--runtime node` (lite), `--engines download`, per-tool downloads, engine-free tools are identical on every OS and under 1 MB; Docker builds from the lite bundle; dynamic release matrix; smoke tests for every bundle and for the Docker image.
- **Web**: string options, text preview with Copy.
- **Cleanup**: removed `scripts/prune-tools.mjs`, stale `vendor/tectonic-cache`, `dist/`, stray draft files.
- Version 0.3.0 (`core/version.mjs` must equal `package.json`).

## CI status (update this first thing next session)
- Commit `faeed2a` (the overhaul): Docker (all, pdf-pages only, latex-to-docx only) and the lite-bundle smoke test passed on GitHub; both Test jobs (ubuntu, macOS) failed with `ECONNREFUSED` in `core/test/integration/server.test.mjs`. Cause: a top-level `await readFile(...)` placed between tests let the node:test runner fire the file's `after()` hook (server close) early. Not a product bug.
- Fix pushed as `dc7749f` (fixture is read next to the other top-level awaits). CI run `40970281809` was still running when this session stopped: check it with `gh run view 40970281809 -R rajatgedam/ToolMaster --json status,conclusion,jobs`. Rule: never put a top-level `await` between `test(...)` calls in a file that has `before`/`after` hooks.
- Not yet run at all: the Release workflow (`gh workflow run release.yml --ref main`, tick "full" via `-f full=true`), so the new matrix, lite bundles on Windows and the Brotli-11 build time on runners are unverified.
- The editor tab `core/index.mjs.new` (if still open) is a deleted stale draft; `core/index.mjs` is the real file.

## State at end of session
Locally green: 329 backend tests (99.3% line coverage), 62 web tests, a real all-tools single executable built and smoke-tested (79 MB zip), a lite `pdf-pages` bundle built and smoke-tested from another folder (0.4 MB). **Not yet run on GitHub**: the rewritten `ci.yml` / `release.yml`, the Docker build (no Docker daemon locally) and Windows/Linux packaging of the new tools. Check CI first thing; expect small fixes (the previous refactor needed three CI iterations).

Quick use:
```
npm run setup && npm test
node bin/toolmaster.mjs list --json
node bin/toolmaster.mjs doc-to-markdown -i report.pdf -o -
node bin/toolmaster.mjs pdf-pages -i in.pdf -o out.pdf -O pages=r1,1-r2
node bin/toolmaster.mjs mcp                         # for AI clients
npm run package -- --tools pdf-pages --runtime node --zip     # 0.4 MB, any OS
node scripts/smoke-bundle.mjs dist/ToolMaster-pdf-pages-lite
```

## Next steps
0. Push, watch CI, run the Release workflow by hand (ticking "full" at least once), fix what the matrix finds (likely: Windows launcher quoting in lite bundles, `unzip`/`zip` availability, Docker `warmup` for engine-free tools, runtime of Brotli-11 on the Windows runner). Then publish with `git tag v0.3.0 && git push origin v0.3.0` and make the GHCR packages public (`toolmaster`, `toolmaster-<tool>`; not scriptable). Per-tool images are new names; make each public.
1. Adding the next tool: follow "Adding a tool" in ARCHITECTURE.md. Remember the smoke cases (tests fail until you add them) and `npm run catalog`.
2. Ideas that fit the model: OCR as an optional engine for scanned PDFs, a `merge` mode for `pdf-pages`, image compress/convert (binary kind), Markdown to PDF/DOCX (Pandoc, no new engine), CSV/JSON inspector, archive unzip (needs a safe extractor with traversal checks like `core/pack.mjs`).
3. Linux/Windows OS sandbox (bubblewrap/Landlock, AppContainer) now matters more: every worker relies on it for defence in depth there.
4. Per-engine pack cache in `build-portable` so Pandoc is compressed once per CI job, not once per bundle (9.5 minutes for the all-bundle, mostly Brotli-11).
5. Optional: zstd packs when Node stabilises them; HTTP transport for MCP; code signing.

## Gotchas learned this session
- The macOS Seatbelt profile blocks Node's startup `lstat` of parent folders; `ro` folders therefore also get metadata-only access to their ancestors. Without this a sandboxed `node script.mjs` under `/Users/...` fails with `EPERM lstat '/Users'`.
- A worker that reports a handled error must not be required to write its output file: `runProcess` has `optional` outputs and `ctx.isolate` checks them after reading `result.json`.
- `fetch` ignores a custom `Host` header; test Host checks with `node:http`.
- pdf-lib: `PDFDocument.load` overwrites Producer unless `updateMetadata: false`; a damaged PDF may load and then throw in `getPageCount()`, so wrap both.
- pdf.js in a bundle needs `globalThis.pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs")`, otherwise it hunts for a worker file next to the executable.
- Sniffing a CSV needs consistent comma counts per line; a marker line in test data breaks it (tests use `1,%%MARKER`).
- The file tools have no `sample`: the web "Load sample" button hides itself, smoke tests use `test/fixtures/sample.pdf`.
- Do not run `npm run coverage` while a Brotli-11 packaging job runs; both are CPU heavy and the sandboxed cold-cache test is time sensitive.
- No overwrite tool exists in this environment: replace a file by removing it and creating it again, or edit in place.
- Never commit the user's resume files (`RGit/VKProfile`), `vendor/` or `dist/`.
