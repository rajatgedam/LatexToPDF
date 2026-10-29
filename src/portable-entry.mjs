// Entry point bundled into the single-file executable (CommonJS, so no top-level await).
import { main, USAGE_HINT } from "./portable.mjs";

// Single-executable apps report argv as [execPath, execPath, ...userArgs].
main(process.argv.slice(2)).then(
  (code) => {
    if (code !== null) process.exitCode = code;
  },
  (err) => {
    console.error(`error: ${err?.message ?? "unexpected failure"}\n${USAGE_HINT}`);
    process.exit(1);
  },
);
