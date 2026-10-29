const CSP_META = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:">`;

/** Make pandoc's HTML safe to show in an iframe: no network, no scripts, no remote images. Works for pages and fragments. */
export function lockDown(html) {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (open) => `${open}${CSP_META}`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">${CSP_META}<title>Preview</title></head><body>${html}</body></html>`;
}
