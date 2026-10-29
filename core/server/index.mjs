import { createApp, listen } from "./app.mjs";

/** Fixed argv per platform; the URL is always a single argument and never goes through a shell. */
export function browserCommand(platform, url) {
  const u = new URL(url);
  if (u.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) {
    throw new Error("Refusing to open a non-loopback URL");
  }
  if (platform === "darwin") return { cmd: "open", args: [url] };
  if (platform === "win32") return { cmd: "rundll32", args: ["url.dll,FileProtocolHandler", url] };
  return { cmd: "xdg-open", args: [url] };
}

/** Start the UI server. Returns `{ server, url, close }`. */
export async function startServer({ config, runner, port, fallbackToRandom } = {}) {
  const server = createApp({ config, runner });
  const bound = await listen(server, {
    host: config.host,
    port: port ?? config.port,
    fallbackToRandom: fallbackToRandom ?? (port === undefined && !config.portExplicit),
  });
  const urlHost = bound.host.includes(":") ? `[${bound.host}]` : bound.host;
  return {
    server,
    url: `http://${urlHost}:${bound.port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
