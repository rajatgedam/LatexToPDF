const WILDCARD_HOSTS = new Set(["0.0.0.0", "::", "[::]"]);

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const BASE_HEADERS = {
  "content-security-policy": CSP,
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};

/** Apply the baseline security headers; API responses are never cached. */
export function applySecurityHeaders(res, { api = false } = {}) {
  for (const [k, v] of Object.entries(BASE_HEADERS)) res.setHeader(k, v);
  if (api) res.setHeader("cache-control", "no-store");
}

/** Exact `host:port` values this server answers to (loopback + explicit extras). */
export function allowedHostSet(port, { host, allowedHosts = [] }) {
  const set = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
  if (host && !WILDCARD_HOSTS.has(host)) set.add(`${host.toLowerCase()}:${port}`);
  for (const h of allowedHosts) set.add(h.includes(":") && !h.startsWith("[") ? h : `${h}:${port}`);
  return set;
}

export const isAllowedHost = (hostHeader, allowed) => typeof hostHeader === "string" && allowed.has(hostHeader.toLowerCase());

/** Absent Origin is fine (non-browser clients); a present Origin must be one of ours. */
export function isAllowedOrigin(origin, allowed) {
  if (origin === undefined) return true;
  try {
    return allowed.has(new URL(origin).host.toLowerCase());
  } catch {
    return false;
  }
}
