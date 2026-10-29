import { createHash } from "node:crypto";

export const PINNED_VERSION = "0.17.0";
const BASE = "https://github.com/tectonic-typesetting/tectonic/releases/download";

// SHA-256 digests copied from the official GitHub release metadata for tectonic@0.17.0.
const ASSETS = {
  "darwin-arm64": ["aarch64-apple-darwin.tar.gz", "a3f1cac7c5678f01661a92212f58480ae3b0634115d880dbc59e2953ded45667"],
  "darwin-x64": ["x86_64-apple-darwin.tar.gz", "7c90ef5b6ddb1eb1937e4337add5237b79338e4b9676459fa91187d24d6cdf80"],
  "linux-arm64": ["aarch64-unknown-linux-musl.tar.gz", "b10954a95404f3ab2328d2fa59a5ebab8e657f893fab096f98be8db7c0c979b8"],
  "linux-x64": ["x86_64-unknown-linux-musl.tar.gz", "8533d07f9ccbd7a65824b9e0459041bca34af1eb33daba48f59215593753a3b7"],
  "win32-x64": ["x86_64-pc-windows-msvc.zip", "f61ce51f0b0ade1015b7de7ef368541c5424e9756ecbd0d7af97d6d48030845f"],
};

export function assetFor(platform, arch) {
  const entry = ASSETS[`${platform}-${arch}`];
  if (!entry) throw new Error(`Unsupported platform ${platform}/${arch}; set LATEX2PDF_ENGINE to a tectonic binary`);
  const name = `tectonic-${PINNED_VERSION}-${entry[0]}`;
  return { name, sha256: entry[1], url: `${BASE}/tectonic%40${PINNED_VERSION}/${name}` };
}

export function assertSha256(buffer, expectedHex) {
  const actual = createHash("sha256").update(buffer).digest("hex");
  if (actual !== expectedHex) throw new Error(`Checksum mismatch: expected ${expectedHex}, got ${actual}`);
}
