export const SENTINEL = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

export const packageName = (platform, arch) => `LatexToPDF-${platform}-${arch}`;
export const exeName = (platform) => (platform === "win32" ? "latex2pdf.exe" : "latex2pdf");

export function launcherFor(platform) {
  if (platform === "win32") {
    return { file: "LatexToPDF.bat", executable: false, content: '@echo off\r\ncd /d "%~dp0"\r\n"%~dp0latex2pdf.exe" ui\r\n' };
  }
  const content = '#!/bin/sh\ncd "$(dirname "$0")" || exit 1\nexec ./latex2pdf ui\n';
  return { file: platform === "darwin" ? "LatexToPDF.command" : "LatexToPDF.sh", executable: true, content };
}

export const seaConfig = ({ main, output }) => ({ main, output, disableExperimentalSEAWarning: true });

export function postjectArgs({ exe, blob, platform }) {
  const args = [exe, "NODE_SEA_BLOB", blob, "--sentinel-fuse", SENTINEL];
  if (platform === "darwin") args.push("--macho-segment-name", "NODE_SEA");
  return args;
}
