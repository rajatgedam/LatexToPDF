# Research: keeping a many-tool local platform small, safe and agent-friendly

Date: 2026-10-29. Question: ToolMaster will grow by ten tools; how do we keep downloads small, keep untrusted inputs contained, and let any AI session call the tools instead of writing throwaway scripts? Everything below was read or measured in this session; URLs are the sources used.

## 1. Size and compression

| Finding | Source | Consequence here |
| --- | --- | --- |
| Node SEA embeds the app into a copy of the `node` binary; assets can be embedded; `useCodeCache`/`useSnapshot` only work on the build platform; `useVfs` + `vfsArchive` (zip) arrived in v26.9 | https://nodejs.org/api/single-executable-applications.html | The 114 MB runtime is a fixed cost per single-executable download; it cannot be shrunk from inside the SEA. We offer a **lite** build without it instead |
| `node:zlib` has Brotli (stable) and Zstandard (`zstdCompress`, v22.15 / v23.8, experimental). Brotli quality 11 is meant for offline/build-time compression | https://nodejs.org/api/zlib.html | Release builds pack engines with Brotli 11 using only the standard library; zstd stays a backlog item until it is stable |
| Measured on this machine (MB): Pandoc 186.3 -> gzip-9 41.1, zstd-19 26.3, Brotli-11 23.9; Tectonic 51.5 -> 20.6, 14.7, 13.3; Tectonic offline cache (tar) 45.2 -> 10.6, 6.1, 5.7. Brotli-11 took 258 s for Pandoc | local benchmark (`/tmp/tm-compress-bench.mjs`, not kept) | Packs cut the engines from 283 MB to 43 MB (-85%) and make a zip of already-compressed packs pointless to re-compress |
| Container images spend 76% of start-up time pulling data, of which only 6.4% is read | Harter et al., "Slacker: Fast Distribution with Lazy Docker Containers", FAST '16, https://www.usenix.org/conference/fast16/technical-sessions/presentation/harter | Ship less, fetch lazily: engines unpack on first use, can be fetched on demand (`--engines download`), and a bundle contains only the tools asked for |
| Package-by-feature extras: MarkItDown installs only the format dependencies you ask for (`markitdown[pdf,docx]`) | https://github.com/microsoft/markitdown | Same idea, enforced by the bundler: a bundle includes only the libraries its tools import (esbuild metafile) |

Result (macOS arm64, zip): everything (4 tools) 78.7 MB (157 MB unpacked) vs 107 MB (394 MB) for 2 tools before; `pdf-pages` lite 0.36 MB; an engine-free tool adds well under 1 MB. Unpacked size dropped 60%, and the tool count doubled.

## 2. Similar systems and what we took from them

| System | Approach | Taken / not taken |
| --- | --- | --- |
| Microsoft MarkItDown (MIT) | Files -> Markdown "for LLMs and text analysis pipelines"; Markdown is token-efficient; plugins; an MCP package; warns it "performs I/O with the privileges of the current process" and tells callers to use the narrowest convert function | **Taken**: the `doc-to-markdown` tool, page markers, byte sniffing, MCP package idea, and the confinement of file paths in our MCP server. Not taken: Python runtime, remote/cloud converters, URL fetching |
| Stirling-PDF | 50+ PDF tools, one REST API per tool, desktop/server/Docker, no-code pipelines | **Taken**: per-tool endpoints and the PDF tool category. Not taken: JVM server, pipelines (backlog: chaining) |
| CyberChef (GCHQ) | Operations with typed inputs/outputs and typed, auto-validated arguments, a categories file for the menu, a Node API | **Taken**: manifest-declared option types with validation in the core (never in tools), category menu, same operations through UI/CLI/API. Not taken: client-side-only execution |
| Model Context Protocol (https://modelcontextprotocol.io) | JSON-RPC 2.0 over stdio; `initialize`, `tools/list`, `tools/call`, tool annotations, structured content | **Taken**: a dependency-free server generated from manifests |
| Node permission model | "Seat belt" for trusted code; "does not provide security guarantees in the presence of malicious code" | **Not used as a boundary**; we rely on a separate process, OS sandbox and limits instead (https://nodejs.org/api/permissions.html) |

## 3. Papers behind the agent-facing design

- Schick et al., **Toolformer** (arXiv:2302.04761, 2023): models can learn to call external tools through simple APIs. A uniform API per tool (our manifest) is what makes this cheap.
- Wang et al., **Voyager** (arXiv:2305.16291, 2023): an ever-growing library of executable skills that are retrieved and reused beats re-deriving behaviour. Our tools are that skill library, with tests.
- Cai et al., **Large Language Models as Tool Makers** (arXiv:2305.17126, 2023): once-off tool making is amortised over many cheap tool uses, and cached tools act as a "functional cache". This is the case for promoting recurring runtime scripts (read a PDF, cut pages) into reviewed tools.
- Wang et al., **Executable Code Actions Elicit Better LLM Agents / CodeAct** (arXiv:2402.01030, ICML 2024): code as the action space outperforms fixed JSON tool calls by up to 20% on their benchmark. The tension is real: agents *want* code. Our answer is to keep code flexible for the novel parts, but provide vetted, sandboxed tools for the recurring, risky parts (parsing untrusted documents), exposed so that a code-writing agent can call them with one line.
- Operational conclusion for `doc-to-markdown` and `pdf-pages`: the two jobs agents re-script most (reading a document, cutting pages) are deterministic, input-hostile and need no creativity; they belong in a tool.

## 4. Decisions (ADR style)

1. **Shared engine catalog.** Alternatives: per-tool engine specs (duplicates, as seen with a second Pandoc tool) or a plugin registry with network lookup (more attack surface). Chosen: files in `engines/`, manifests name ids.
2. **Process isolation for JavaScript parsers.** Alternatives: in-process (a malicious PDF can exhaust memory or loop with no way to preempt synchronous code), `worker_threads` (no OS sandbox, hard to run from a single-file bundle), Node permission model (documented as not a boundary). Chosen: run a copy of the same program through the existing hardened `runProcess`, so engines and parsers share one security story and the macOS sandbox covers both.
3. **Libraries.** `@cantoo/pdf-lib` over `pdf-lib` (last published 2022), `pdfjs-dist` for text extraction (Apache-2.0, no native code). Rejected: poppler/qpdf (native, GPL/Apache binaries per OS), Python.
4. **Pandoc for everything it reads.** It already ships; reading pptx/xlsx/docx/epub/odt/html/rtf/csv costs 0 MB extra. Only PDF needs a second reader.
5. **MCP over stdio, hand-written.** No dependency, generated from manifests, with file-root confinement. HTTP transport is backlog.
6. **Lite bundle + packs rather than another runtime.** Bun/Deno `compile` could shrink the executable but would change the runtime under every test; not evaluated further.
7. **Brotli, not UPX.** UPX breaks macOS signing and trips antivirus; packs unpack to the original binary, which keeps checksums and signatures meaningful.
8. **Smoke cases are mandatory per tool.** Tests fail when a tool has no case in `scripts/smoke-bundle.mjs` or `scripts/smoke-http.mjs`, so ten more tools cannot ship untested.

## 5. Open questions

- OCR for scanned PDFs would need an engine (Tesseract ~ tens of MB plus language data): add it as a catalog entry and an optional pass in `doc-to-markdown`.
- Sharing one Node runtime across many single-tool executables (a runtime pack) would make "ten separate downloads" cheaper; lite bundles already achieve it for people who have Node.
- Compression time grows with engine size (Pandoc 258 s at Brotli 11): pack once per engine per CI run and reuse across bundles.
