import { defineTool } from "../../core/sdk.mjs";

const SHA = "a".repeat(64);

export const fakeEngineSpec = (overrides = {}) => ({
  id: "fake-engine",
  binary: "fakebin",
  versionArgs: ["--version"],
  assets: { "darwin-arm64": { url: "https://example.test/fake.tar.gz", sha256: SHA } },
  ...overrides,
});

export const fakeManifest = (overrides = {}) => ({
  id: "fake-tool",
  name: "Fake Tool",
  description: "Does fake things",
  category: "testing",
  icon: "T",
  input: { kind: "text", accept: [".txt"] },
  output: { contentType: "text/plain", extension: "out" },
  preview: "none",
  ui: { action: "Run" },
  ...overrides,
});

/** A tool that upper-cases its text input; `run` can be replaced per test. */
export const fakeTool = ({ manifest = {}, run, preview, warmup } = {}) =>
  defineTool({
    manifest: fakeManifest(manifest),
    run: run ?? (async (_ctx, { input }) => ({ data: Buffer.from(String(input).toUpperCase()), meta: { chars: String(input).length } })),
    ...(preview ? { preview } : {}),
    ...(warmup ? { warmup } : {}),
  });
