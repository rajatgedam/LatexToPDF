// Which release bundles to build, as a GitHub Actions matrix. Pure so it can be tested; scripts/plan-release.mjs prints it.

export const RELEASE_OS = [
  { os: "macos-latest", platform: "darwin-arm64" },
  { os: "macos-15-intel", platform: "darwin-x64" },
  { os: "ubuntu-latest", platform: "linux-x64" },
  { os: "ubuntu-24.04-arm", platform: "linux-arm64" },
  { os: "windows-latest", platform: "win32-x64" },
];

/**
 * @param tools  [{ id, engines: string[] }] the tools in the repository
 * @param full   true for a tag release (every bundle), false for a quick dry run (the all-in-one only)
 *
 * Per OS: one single-executable bundle with everything plus one per tool, and a lite (needs Node) bundle with everything.
 * Once, on any OS: a lite bundle for each tool that needs no engine, because those are identical on every OS and tiny.
 */
export function planRelease({ tools, full }) {
  const toolArg = (id) => (id === "all" ? "" : id);
  const entry = (os, bundle, runtime) => ({ os: os.os, name: `${os.platform}-${bundle}-${runtime}`, bundle, tools: toolArg(bundle), runtime, portable: false });
  const perOs = RELEASE_OS.flatMap((os) => [
    entry(os, "all", "sea"),
    ...(full ? [...tools.map((t) => entry(os, t.id, "sea")), entry(os, "all", "node")] : []),
  ]);
  const portable = full
    ? tools.filter((t) => t.engines.length === 0).map((t) => ({ os: "ubuntu-latest", name: `any-${t.id}-node`, bundle: t.id, tools: t.id, runtime: "node", portable: true }))
    : [];
  return [...perOs, ...portable];
}

/** Docker images to publish: everything, and each tool on its own. Image names are lowercase and registry safe. */
export const dockerImages = (tools) => [
  { image: "toolmaster", tools: "all" },
  ...tools.map((t) => ({ image: `toolmaster-${t.id}`, tools: t.id })),
];
