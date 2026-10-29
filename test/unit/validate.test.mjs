import { test } from "node:test";
import assert from "node:assert/strict";
import { findViolations, assertSafe } from "../../src/validate.mjs";

const doc = (body) => `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}`;

const BAD = {
  write18: "\\immediate\\write18{touch /tmp/x}",
  write: "\\newwrite\\f \\immediate\\openout\\f=x.txt \\write\\f{hi}",
  openin: "\\openin5=/etc/passwd",
  read: "\\read5 to \\x",
  inputPath: "\\input{/etc/passwd}",
  inputDots: "\\input{../secret}",
  inputExt: "\\input{secret.txt}",
  include: "\\include{other}",
  inputIfFile: "\\InputIfFileExists{/etc/passwd}{}{}",
  directlua: "\\directlua{os.execute('id')}",
  csname: "\\csname immediate\\endcsname",
  catcode: "\\catcode`\\%=12",
  scantokens: "\\scantokens{x}",
  shellesc: "\\usepackage{shellesc}",
  minted: "\\usepackage[cache=false]{minted}",
  verbatiminput: "\\verbatiminput{/etc/passwd}",
  lstinput: "\\lstinputlisting{/etc/passwd}",
  filecontents: "\\begin{filecontents*}{x.tex}hi\\end{filecontents*}",
  graphicAbs: "\\includegraphics{/etc/passwd}",
  graphicDots: "\\includegraphics[width=1cm]{../../secret.png}",
  graphicHome: "\\includegraphics{~/secret.png}",
  picfile: "\\XeTeXpicfile /etc/passwd",
  usepkgPath: "\\usepackage{/tmp/evil}",
  classPath: "\\documentclass{../evil}",
  graphicspath: "\\graphicspath{{/etc/}}",
};

for (const [name, snippet] of Object.entries(BAD)) {
  test(`rejects ${name}`, () => {
    assert.ok(findViolations(doc(snippet)).length > 0, snippet);
    assert.throws(() => assertSafe(doc(snippet)), { code: "POLICY_VIOLATION" });
  });
}

test("allows ordinary resume constructs", () => {
  const ok = doc(
    "\\input{glyphtounicode}\n\\usepackage{hyperref}\\href{https://x.dev}{site}\n\\section*{Skills}\\begin{itemize}\\item A\\end{itemize} 100\\% \\textbf{x}",
  );
  assert.deepEqual(findViolations(ok), []);
});

test("violations in comments are ignored but escaped percent is not a comment", () => {
  assert.deepEqual(findViolations(doc("% \\write18{x}")), []);
  assert.equal(findViolations(doc("50\\% \\write18{x}")).length, 1);
});

test("violations report rule and 1-based line", () => {
  const v = findViolations("a\nb\n\\openin3=x");
  assert.equal(v.length, 1);
  assert.equal(v[0].line, 3);
  assert.equal(v[0].rule, "openin");
});

test("a longer control word is not mistaken for a banned one", () => {
  assert.deepEqual(findViolations(doc("\\inputlineno \\readingtime")), []);
});
