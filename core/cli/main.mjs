/** Turn a runCli() result into process behavior: set the exit code, or keep the web server alive until a signal. */
export function finish(result) {
  if (typeof result === "number") {
    process.exitCode = result;
    return;
  }
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.once(sig, async () => {
      await result.ui.close();
      process.exit(0);
    });
  }
}
