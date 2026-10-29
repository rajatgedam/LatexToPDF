# Security Rules

Baseline: OWASP Top 10 + Cloudflare application-security practices (managed-rules / OWASP Core thinking: validate at the edge, deny by default, limit body size, rate limit, strict headers, least privilege, no information leakage). This tool has no Cloudflare in front of it because it is local-only, so the same controls are enforced in-process.

These are rules, not suggestions. Every rule has a test in `test/`. Do not weaken one without recording the reason in PROGRESS.md.

## R1 Network exposure
- R1.1 Bind to `127.0.0.1` by default. Binding elsewhere requires `LATEX2PDF_ALLOW_REMOTE=1` and prints a warning.
- R1.2 Validate the `Host` header against an allowlist (`localhost`, `127.0.0.1`, `[::1]` + the bound port) to defeat DNS rebinding.
- R1.3 For `POST`, if an `Origin` header is present it must match the allowed host list (CSRF / drive-by from a web page). No CORS headers are ever emitted.
- R1.4 Only `GET`, `HEAD`, `POST` (compile route only) are allowed; others get 405.

## R2 Input handling (deny by default)
- R2.1 Hard max source size (default 1 MiB), enforced while streaming the body, not after.
- R2.2 Content-Type allowlist for POST: `application/json`, `text/plain`, `application/x-tex`; else 415.
- R2.3 Reject NUL bytes and invalid UTF-8 / non-string `source`.
- R2.4 Static policy scan (`src/validate.mjs`) rejects primitives that touch files, processes or the network: `\write`/`\write18`, `\immediate`, `\openout`, `\openin`, `\read`, `\input` unless the argument is a bare name (`[A-Za-z0-9_-]+`, needed for `glyphtounicode`), `\include`, `\InputIfFileExists`, `\csname`, `\catcode`, `\scantokens`, `\directlua`, `\special`, `filecontents`, verbatim/listing file inputs, dangerous packages (`shellesc`, `minted`, `catchfile`, ...), and path-escaping arguments (`/abs`, `..`, `~`, `\`, `:`) to `\includegraphics`, `\graphicspath`, `\usepackage`, `\documentclass`, `\XeTeXpicfile`. **Finding (2026-10-28): `tectonic --untrusted` still allows `\input{/absolute/path}`, so this scan is the primary file-read barrier.** Keep the list authoritative and add a test for every new rule.
- R2.5 Output path (CLI/API) must end in `.pdf`, resolve to a regular file location (not a directory, not a symlink), parent directory must exist (or `mkdir: true`), written atomically (temp + rename).

## R3 Engine isolation (assume R2.4 can be bypassed)
- R3.1 Always pass `--untrusted` and never pass `-Z shell-escape` (default is off). Integration test proves `\write18` does not execute even with the policy scan bypassed.
- R3.2 Run Tectonic with `spawn` (no shell), argument array only, never interpolating user data into args.
- R3.3 Fresh `fs.mkdtemp` directory (mode 0700) per compile, deleted in `finally`. The engine cwd is that directory only.
- R3.4 Scrubbed environment: only `PATH` (minimal), `HOME` unchanged for cache lookup, `TECTONIC_CACHE_DIR`, `LANG`. No inherited secrets (`GITHUB_TOKEN`, cloud keys etc.).
- R3.5 Wall-clock timeout with SIGKILL of the whole process group; output size cap; stdout/stderr capture capped.
- R3.6 Concurrency limit; overflow returns `BUSY` immediately (no unbounded queue = no memory DoS).
- R3.7 `LATEX2PDF_OFFLINE=1` adds `--only-cached` so the engine makes no network calls (and the sandbox denies network).
- R3.8 OS sandbox (`src/sandbox.mjs`, macOS `sandbox-exec`, default `auto`): the engine cannot read `/Users`, `/Volumes`, `/private/tmp`, `/private/var/folders` except its work dir, package cache and engine dir, and cannot write outside work dir/cache. Paths are passed as `-D` params, never interpolated into the profile. Integration tests prove an absolute `\input` of a secret fails even with the policy scan bypassed. **Linux/Windows have no sandbox yet** (backlog: bubblewrap/Landlock, AppContainer); there the policy scan (R2.4) is the only file-read barrier.

## R4 HTTP hardening
- R4.1 Security headers on every response: `Content-Security-Policy` (`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-src blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `Permissions-Policy` (deny camera/mic/geo), `Cache-Control: no-store` on API.
- R4.2 Per-IP token bucket rate limit (default 60/min) -> 429 + `Retry-After`.
- R4.3 Request/headers timeouts and `maxHeaderSize` kept at Node defaults or lower; keep-alive timeout short.
- R4.4 Static file serving resolves paths under `web/dist` only; reject `..`, encoded traversal, NUL, symlinks escaping root.
- R4.5 Errors never expose stack traces, absolute paths, env values. Engine logs have the temp dir path replaced with `<work>`.

## R5 Supply chain
- R5.1 Backend has zero runtime npm dependencies (keep it that way unless justified).
- R5.2 Engine binary is pinned by version and verified by SHA-256 before extraction; mismatch aborts and deletes the download.
- R5.3 Frontend dependencies are pinned by lockfile; run `npm audit --omit=dev` before release; fix high/critical.
- R5.4 No remote scripts/fonts/CDNs in the UI (CSP would block them anyway).
- R5.5 Secrets: none are needed. Never commit `.env`. GitHub token stays in the OS keyring (gh CLI).

## R6 Privacy
- R6.1 No telemetry, no analytics, no outbound calls except Tectonic package fetch (and only when not offline).
- R6.2 Source and PDFs are never logged; logs carry sizes, durations and error codes only.
- R6.3 Temp files are deleted after each request; UI keeps the PDF only as an in-memory blob URL.

## Verification checklist (run before each release)
1. `npm test` and `npm run coverage` green (>= 80 % on `src/`).
2. `npm audit --omit=dev` in root and `web/` shows no high/critical.
3. Manual: `curl -H 'Host: evil.test' http://127.0.0.1:5757/api/health` returns 403.
4. Manual: compile a document with `\immediate\write18{touch /tmp/pwned}`; file must not exist and the API must return `POLICY_VIOLATION`.
