const CSP_META = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:">`;
// The preview may not use inline CSS (the app's CSP is inherited by blob pages), so legibility comes from markup the CSP does not touch.
const LIGHT_META = `<meta name="color-scheme" content="light">`;
const BODY_ATTRS = ' bgcolor="#ffffff" text="#1a1a1a" link="#0645ad" vlink="#0645ad"';

/** Make pandoc's HTML safe to show in an iframe: no network, no scripts, no remote images; readable in light and dark mode. */
export function lockDown(html) {
  if (!/<head[^>]*>/i.test(html)) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">${CSP_META}${LIGHT_META}<title>Preview</title></head><body${BODY_ATTRS}>${html}</body></html>`;
  }
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<head[^>]*>/i, (open) => `${open}${CSP_META}${LIGHT_META}`)
    .replace(/<body(?![^>]*\bbgcolor=)([^>]*)>/i, (_m, attrs) => `<body${attrs}${BODY_ATTRS}>`);
}
