import { test } from "node:test";
import assert from "node:assert/strict";
import { lockDown } from "../../preview.mjs";

const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:">`;

test("a full pandoc page gets the CSP as the first thing in <head>", () => {
  const out = lockDown('<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8" />\n<title>T</title></head><body><h1>Hi</h1></body></html>');
  assert.ok(out.includes(`<head>${CSP}`));
  assert.equal(out.match(/Content-Security-Policy/g).length, 1);
  assert.match(out, /<h1>Hi<\/h1>/);
});

test("a bare fragment is wrapped into a locked-down document", () => {
  const out = lockDown("<p>fake</p>");
  assert.match(out, /^<!doctype html>/);
  assert.ok(out.includes(CSP));
  assert.match(out, /<body bgcolor="#ffffff" text="#1a1a1a"[^>]*><p>fake<\/p><\/body>/);
  assert.match(out, /color-scheme" content="light"/);
});

test("inline CSS (blocked by the inherited CSP anyway) is dropped and light colours are set with plain attributes", () => {
  const out = lockDown('<html><head><style>html{color:light-dark(#111,#eee)}</style></head><body class="x"><p>Hi</p></body></html>');
  assert.ok(!out.includes("<style"));
  assert.match(out, /<body class="x" bgcolor="#ffffff" text="#1a1a1a"/);
  assert.match(out, /<meta name="color-scheme" content="light">/);
  assert.equal(lockDown(out).match(/bgcolor=/g).length, 1, "applying it twice does not repeat the attributes");
});

test("head tags with attributes are handled", () => {
  assert.ok(lockDown('<html><head profile="x"><title>t</title></head></html>').includes(`<head profile="x">${CSP}`));
});
