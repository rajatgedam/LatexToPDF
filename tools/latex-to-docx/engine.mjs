const BASE = "https://github.com/jgm/pandoc/releases/download/3.13";

/** Pandoc 3.13 (GPL-2.0-or-later), downloaded on demand and never bundled in the git repo. Digests come from the official release metadata. */
export const pandoc = {
  id: "pandoc",
  binary: "pandoc",
  versionArgs: ["--version"],
  homepage: "https://pandoc.org",
  license: "GPL-2.0-or-later",
  assets: {
    "darwin-arm64": { url: `${BASE}/pandoc-3.13-arm64-macOS.zip`, sha256: "f436d18bebbfb3ddd326597686dacab9fac5dc23bd060495020f35a28a43a7c3" },
    "darwin-x64": { url: `${BASE}/pandoc-3.13-x86_64-macOS.zip`, sha256: "1823278715aa405aaf21b59cde5dc789346aa8d4fc307467f9a9ee84162bedc5" },
    "linux-arm64": { url: `${BASE}/pandoc-3.13-linux-arm64.tar.gz`, sha256: "21e1d4ba09bd0b334590d204580fd4f6629b21be4ab6a32b26cc98982e9e0c68" },
    "linux-x64": { url: `${BASE}/pandoc-3.13-linux-amd64.tar.gz`, sha256: "38aa33b325a2bc96a4c39409631212db55702f564250bcdbead180b3bf646389" },
    "win32-x64": { url: `${BASE}/pandoc-3.13-windows-x86_64.zip`, sha256: "23e1f2e978a3df80db8bf65c9c59534f41a23140480cfb4f783a882ab7dc6a4e" },
  },
};
