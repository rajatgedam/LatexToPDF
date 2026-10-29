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
  assert.match(out, /<body><p>fake<\/p><\/body>/);
});

test("head tags with attributes are handled", () => {
  assert.ok(lockDown('<html><head profile="x"><title>t</title></head></html>').includes(`<head profile="x">${CSP}`));
});
