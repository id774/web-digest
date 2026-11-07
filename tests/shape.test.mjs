import test from "node:test";
import assert from "node:assert/strict";

import {
  DEDUPE_MIN_CHARS,
  MAX_REQUEST_MATERIAL_CHARS,
  MIN_MATERIAL_CHARS,
  chunkMaterial,
  judgeSize,
  normalizeCode,
  normalizeText,
  render,
  shape,
} from "../src/shape/shape.js";

const NBSP = String.fromCharCode(0x00a0);

function paragraph(text) {
  return { kind: "paragraph", text };
}

// Enough body to clear MIN_MATERIAL_CHARS without the test caring about it.
function filler(marker) {
  return paragraph(
    `${marker} ${"the substance of a page is carried by its sentences. ".repeat(6)}`,
  );
}

test("normalizeText folds spaces, non-breaking spaces and line breaks", () => {
  assert.equal(normalizeText(`  a${NBSP}${NBSP}b \n\n c \t d  `), "a b c d");
});

test("normalizeCode keeps line breaks and strips trailing spaces", () => {
  assert.equal(normalizeCode("$ one   \n$ two\t\n"), "$ one\n$ two");
});

test("normalizeCode keeps the leading indentation of the first line", () => {
  assert.equal(
    normalizeCode("    first()\n        second()"),
    "    first()\n        second()",
  );
});

test("normalizeCode drops boundary blank lines and trailing whitespace but not indentation", () => {
  assert.equal(
    normalizeCode("\n\n    first()  \n        second()\t\n\n"),
    "    first()\n        second()",
  );
});

test("shape keeps a code block's first-line indentation in the block and the rendered fence", () => {
  const code = "    first()\n        second()";
  const result = shape({
    title: "T",
    blocks: [filler("prose."), { kind: "code", text: code }],
  });
  assert.equal(result.ok, true);
  const block = result.material.blocks.find((b) => b.kind === "code");
  assert.equal(block.text, code);
  assert.ok(result.material.text.includes("```\n" + code + "\n```"));
});

test("normalizeCode collapses three or more blank lines to one", () => {
  assert.equal(normalizeCode("a\n\n\n\n\nb"), "a\n\nb");
  assert.equal(normalizeCode("a\n\nb"), "a\n\nb");
});

test("blocks that carry nothing are dropped", () => {
  const result = shape({
    title: "T",
    blocks: [
      paragraph("   "),
      paragraph("x"),
      paragraph("--- ***"),
      filler("kept."),
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.material.blockCount, 1);
});

test("exact repetition of a long block is removed, short repeats are kept", () => {
  const repeated = "Site footer notice";
  assert.ok(repeated.length >= DEDUPE_MIN_CHARS);
  const result = shape({
    title: "T",
    blocks: [
      paragraph(repeated),
      filler("body."),
      paragraph(repeated),
      { kind: "list-item", text: "Yes" },
      { kind: "list-item", text: "Yes" },
    ],
  });
  assert.equal(result.ok, true);
  const occurrences = result.material.text.split(repeated).length - 1;
  assert.equal(occurrences, 1);
  assert.equal(result.material.text.split("- Yes").length - 1, 2);
});

test("repetition removal is per kind and only above the floor", () => {
  const result = shape({
    title: "T",
    blocks: [
      { kind: "heading", level: 2, text: "Overview" },
      paragraph("Overview"),
      filler("body."),
    ],
  });
  assert.equal(result.ok, true);
  assert.match(result.material.text, /## Overview/);
  assert.match(result.material.text, /\n\nOverview\n\n/);
});

test("same text at different heading levels is not treated as repetition", () => {
  const result = shape({
    title: "T",
    blocks: [
      { kind: "heading", level: 2, text: "Overview" },
      { kind: "heading", level: 3, text: "Overview" },
      filler("body."),
    ],
  });
  assert.equal(result.ok, true);
  assert.match(result.material.text, /## Overview/);
  assert.match(result.material.text, /### Overview/);
});

test("same text at the same heading level is still deduped as exact repetition", () => {
  const result = shape({
    title: "T",
    blocks: [
      { kind: "heading", level: 2, text: "Overview" },
      { kind: "heading", level: 2, text: "Overview" },
      filler("body."),
    ],
  });
  assert.equal(result.ok, true);
  const occurrences = result.material.text.split("Overview").length - 1;
  assert.equal(occurrences, 1);
});

test("render keeps the structure a summary can use", () => {
  const text = render([
    { kind: "heading", level: 3, text: "A heading" },
    { kind: "paragraph", text: "A paragraph." },
    { kind: "list-item", text: "An item" },
    { kind: "quote", text: "A quotation." },
    { kind: "code", text: "$ one\n$ two" },
  ]);
  assert.equal(
    text,
    "### A heading\n\nA paragraph.\n\n- An item\n\n> A quotation.\n\n```\n$ one\n$ two\n```",
  );
});

test("the cells of one table row are joined into one line", () => {
  const text = render([
    { kind: "table-cell", row: 1, text: "Name" },
    { kind: "table-cell", row: 1, text: "Value" },
    { kind: "table-cell", row: 2, text: "Timeout" },
    { kind: "table-cell", row: 2, text: "120s" },
  ]);
  assert.equal(text, "Name | Value\n\nTimeout | 120s");
});

test("charCount is the title plus the rendered body", () => {
  const result = shape({ title: "Title", blocks: [filler("body.")] });
  assert.equal(result.ok, true);
  assert.equal(
    result.material.charCount,
    result.material.title.length + result.material.text.length,
  );
});

test("the size verdicts sit exactly on their boundaries", () => {
  assert.equal(MAX_REQUEST_MATERIAL_CHARS, 200000);
  assert.equal(judgeSize(MIN_MATERIAL_CHARS - 1), "too-little-text");
  assert.equal(judgeSize(MIN_MATERIAL_CHARS), "ok");
  assert.equal(judgeSize(MAX_REQUEST_MATERIAL_CHARS), "ok");
  assert.equal(judgeSize(MAX_REQUEST_MATERIAL_CHARS + 1), "ok");
});

test("a page with no blocks and one with too little text are one verdict", () => {
  assert.deepEqual(shape({ title: "", blocks: [] }), {
    ok: false,
    kind: "too-little-text",
  });
  assert.deepEqual(shape({ title: "T", blocks: [paragraph("Short.")] }), {
    ok: false,
    kind: "too-little-text",
  });
});

test("a long title does not offset a too-short body", () => {
  const title = "Title ".repeat(100).trim();
  const body = "x".repeat(MIN_MATERIAL_CHARS - 1);
  assert.ok(title.length > MIN_MATERIAL_CHARS);
  const result = shape({ title, blocks: [paragraph(body)] });
  assert.deepEqual(result, { ok: false, kind: "too-little-text" });
});

test("table cells are exempt from global repetition removal", () => {
  const cellText = "Recurring configuration value used in every row";
  assert.ok(cellText.length >= DEDUPE_MIN_CHARS);
  const result = shape({
    title: "T",
    blocks: [
      { kind: "table-cell", row: 1, text: cellText },
      { kind: "table-cell", row: 2, text: cellText },
      filler("body."),
    ],
  });
  assert.equal(result.ok, true);
  const occurrences = result.material.text.split(cellText).length - 1;
  assert.equal(occurrences, 2);
});

test("an oversized page is retained for long-page summarization", () => {
  const result = shape({
    title: "T",
    blocks: [paragraph("x".repeat(MAX_REQUEST_MATERIAL_CHARS + 1))],
  });
  assert.equal(result.ok, true);
  assert.equal(result.material.text.length, MAX_REQUEST_MATERIAL_CHARS + 1);
});

test("chunking keeps content in order without dropping blocks", () => {
  const blocks = [
    { kind: "heading", level: 2, text: "First" },
    paragraph("a".repeat(70)),
    { kind: "heading", level: 2, text: "Second" },
    paragraph("b".repeat(70)),
    { kind: "heading", level: 3, text: "Detail" },
    paragraph("c".repeat(70)),
  ];
  const chunks = chunkMaterial({ title: "T", blocks }, 120);
  assert.ok(chunks.length > 1);
  assert.deepEqual(chunks.flatMap((chunk) => chunk.blocks), blocks);
  assert.equal(chunks[1].blocks[0].kind, "heading");
  assert.equal(chunks[1].blocks[0].level, 2);
});

test("an oversized heading is never fragmented into multiple heading blocks", () => {
  const headingText = "word ".repeat(30).trim();
  const blocks = [
    { kind: "heading", level: 2, text: headingText },
    paragraph("a".repeat(70)),
  ];
  const chunks = chunkMaterial({ title: "T", blocks }, 500);
  const headingBlocks = chunks
    .flatMap((chunk) => chunk.blocks)
    .filter((block) => block.kind === "heading");
  assert.equal(headingBlocks.length, 1);
  assert.equal(headingBlocks[0].text, headingText);
});

test("a heading too large to fit alone fails the whole call closed rather than being split", () => {
  const limit = 100;
  const headingText = "h".repeat(150);
  const blocks = [
    { kind: "heading", level: 2, text: headingText },
    paragraph("body ".repeat(60)),
  ];
  const chunks = chunkMaterial({ title: "T", blocks }, limit);
  assert.deepEqual(chunks, []);
});

test("heading hierarchy context is preserved across chunks when headings are never split", () => {
  const blocks = [
    { kind: "heading", level: 1, text: "Top" },
    { kind: "heading", level: 2, text: "Middle" },
    paragraph("a".repeat(80)),
    { kind: "heading", level: 3, text: "Detail" },
    paragraph("b".repeat(80)),
  ];
  const chunks = chunkMaterial({ title: "T", blocks }, 150);
  assert.ok(chunks.length > 1);
  const lastChunk = chunks[chunks.length - 1];
  assert.match(lastChunk.text, /SECTION: Top > Middle/);
  assert.match(lastChunk.text, /### Detail/);
});

test("only an individually oversized block is split internally", () => {
  const text = `${"sentence one. ".repeat(20)}sentence two.`;
  const chunks = chunkMaterial({ title: "T", blocks: [paragraph(text)] }, 120);
  assert.ok(chunks.length > 1);
  assert.equal(
    chunks
      .flatMap((chunk) => chunk.blocks)
      .map((block) => block.text)
      .join(" "),
    text,
  );
});

test("a block that fits alone with the title is not split by a fixed reserve it never needed", () => {
  const limit = 1000;
  const title = "T";
  const text = "x".repeat(800);
  const chunks = chunkMaterial({ title, blocks: [paragraph(text)] }, limit);

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].blocks.length, 1);
  assert.equal(chunks[0].blocks[0].text, text);
});

test("a fitting table-cell is not fragmented by a fixed reserve it never needed", () => {
  const limit = 1000;
  const title = "T";
  const text = "y".repeat(800);
  const chunks = chunkMaterial(
    { title, blocks: [{ kind: "table-cell", row: 1, text }] },
    limit,
  );

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].blocks.length, 1);
  assert.equal(chunks[0].blocks[0].text, text);
});

test("a fitting list-item is not fragmented by a fixed reserve it never needed", () => {
  const limit = 1000;
  const title = "T";
  const text = "z".repeat(800);
  const chunks = chunkMaterial(
    { title, blocks: [{ kind: "list-item", text }] },
    limit,
  );

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].blocks.length, 1);
  assert.equal(chunks[0].blocks[0].text, text);
});

test("an oversized code block is split at line boundaries, keeping its indentation", () => {
  const lines = [];
  for (let i = 0; i < 30; i += 1) {
    lines.push(`    line ${i} padded with enough text to force a split`);
  }
  const code = lines.join("\n");
  const chunks = chunkMaterial(
    { title: "T", blocks: [{ kind: "code", text: code }] },
    400,
  );
  const codeBlocks = chunks.flatMap((chunk) => chunk.blocks);

  assert.ok(codeBlocks.length > 1);
  assert.ok(codeBlocks.every((block) => block.kind === "code"));
  // No character is added, removed or reordered by splitting: joining the
  // pieces back together reproduces the original code exactly.
  assert.equal(codeBlocks.map((block) => block.text).join(""), code);
  // The second piece still opens with its original leading indentation:
  // trimming here would be exactly the defect this guards against.
  assert.match(codeBlocks[1].text, /^ {4}line/);
});

test("a code block containing a run of three backticks gets a fence longer than any run in its text", () => {
  const code = "before\n```\nnested content\n```\nafter";
  const text = render([{ kind: "code", text: code }]);
  assert.equal(text, `\`\`\`\`\n${code}\n\`\`\`\``);
  assert.ok(text.startsWith("````\n"));
  assert.ok(text.endsWith("\n````"));
});

test("chunking a code block with backticks reserves room for its longer fence, and reconstructs losslessly", () => {
  const runs = "`".repeat(5);
  const code = `${runs}\n${"line of code text repeated to be long enough. ".repeat(10)}`;
  const limit = 200;
  const chunks = chunkMaterial(
    { title: "T", blocks: [{ kind: "code", text: code }] },
    limit,
  );
  assert.ok(chunks.length >= 1);
  for (const chunk of chunks) {
    assert.ok(chunk.charCount <= limit);
  }
  const codeBlocks = chunks.flatMap((chunk) => chunk.blocks);
  assert.equal(codeBlocks.map((block) => block.text).join(""), code);
});

test("a single code line longer than the chunk limit is split but never truncated", () => {
  const line = "x".repeat(500);
  const chunks = chunkMaterial(
    { title: "T", blocks: [{ kind: "code", text: line }] },
    200,
  );
  const codeBlocks = chunks.flatMap((chunk) => chunk.blocks);

  assert.ok(codeBlocks.length > 1);
  assert.equal(codeBlocks.map((block) => block.text).join(""), line);
});

const PAIR = String.fromCodePoint(0x1f600);

function hasLoneSurrogate(text) {
  return /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(
    text,
  );
}

test("a forced cut in a long unbroken paragraph never separates a surrogate pair", () => {
  const limit = 100;
  for (let at = 90; at <= 101; at += 1) {
    const text = `${"x".repeat(at)}${PAIR}${"y".repeat(150)}`;
    const chunks = chunkMaterial(
      { title: "", blocks: [paragraph(text)] },
      limit,
    );
    const pieces = chunks.flatMap((chunk) => chunk.blocks).map((b) => b.text);

    assert.ok(chunks.length > 1, `offset ${at}`);
    assert.equal(pieces.join(""), text, `offset ${at}`);
    for (const chunk of chunks) {
      assert.ok(chunk.charCount <= limit, `offset ${at}`);
      assert.equal(hasLoneSurrogate(chunk.text), false, `offset ${at}`);
    }
  }
});

test("a forced cut in a single long code line never separates a surrogate pair", () => {
  const limit = 100;
  for (let at = 80; at <= 95; at += 1) {
    const line = `  ${"x".repeat(at)}${PAIR}${"y".repeat(150)}`;
    const chunks = chunkMaterial(
      { title: "", blocks: [{ kind: "code", text: line }] },
      limit,
    );
    const pieces = chunks.flatMap((chunk) => chunk.blocks).map((b) => b.text);

    assert.ok(chunks.length > 1, `offset ${at}`);
    assert.equal(pieces.join(""), line, `offset ${at}`);
    for (const chunk of chunks) {
      assert.ok(chunk.charCount <= limit, `offset ${at}`);
      assert.equal(hasLoneSurrogate(chunk.text), false, `offset ${at}`);
    }
  }
});

test("code split at a newline keeps surrogate pairs and indentation untouched", () => {
  const code = `  a${PAIR}\n    b${PAIR}\n`.repeat(20);
  const chunks = chunkMaterial(
    { title: "T", blocks: [{ kind: "code", text: code }] },
    130,
  );
  const pieces = chunks.flatMap((chunk) => chunk.blocks).map((b) => b.text);

  assert.ok(chunks.length > 1);
  assert.equal(pieces.join(""), code);
  for (const piece of pieces.slice(0, -1)) assert.ok(piece.endsWith("\n"));
  for (const chunk of chunks) assert.ok(chunk.charCount <= 130);
});

test("ordinary text with whitespace boundaries and pairs splits as before", () => {
  const text = `${PAIR} word `.repeat(60).trim();
  const chunks = chunkMaterial({ title: "", blocks: [paragraph(text)] }, 100);
  const pieces = chunks.flatMap((chunk) => chunk.blocks).map((b) => b.text);

  assert.ok(chunks.length > 1);
  assert.equal(pieces.join(" "), text);
  for (const chunk of chunks) assert.equal(hasLoneSurrogate(chunk.text), false);
});

test("a surrogate pair that cannot fit in any chunk fails closed", () => {
  assert.deepEqual(
    chunkMaterial({ title: "", blocks: [paragraph(`${PAIR}${PAIR}`)] }, 1),
    [],
  );
  assert.deepEqual(
    chunkMaterial({ title: "", blocks: [{ kind: "code", text: `${PAIR}${PAIR}` }] }, 9),
    [],
  );
});

test("chunking reserves room for a long title", () => {
  const limit = 1000;
  const title = "t".repeat(300);
  const text = "body ".repeat(300).trim();
  const blocks = [paragraph(text)];
  const chunks = chunkMaterial({ title, text, blocks }, limit);

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.charCount <= limit));
  assert.equal(
    chunks
      .flatMap((chunk) => chunk.blocks)
      .map((block) => block.text)
      .join(" "),
    text,
  );
});

test("title overhead with no room for body forces chunkMaterial to fail closed", () => {
  const limit = 120;
  const title = "t".repeat(120);
  const blocks = [paragraph("body ".repeat(60))];
  const chunks = chunkMaterial({ title, blocks }, limit);
  assert.deepEqual(chunks, []);
});

test("heading-context overhead on a later chunk fails closed rather than returning a partial result", () => {
  const limit = 200;
  const headingText = "h".repeat(120);
  const paragraphText = "p".repeat(150);
  const blocks = [
    { kind: "heading", level: 2, text: headingText },
    paragraph(paragraphText),
  ];
  const chunks = chunkMaterial({ title: "", blocks }, limit);
  assert.deepEqual(chunks, []);
});

test("shaping does not reorder or rewrite what it keeps", () => {
  const result = shape({
    title: "  A   title  ",
    blocks: [filler("first."), filler("second."), filler("third.")],
  });
  assert.equal(result.material.title, "A title");
  const order = ["first.", "second.", "third."].map((m) =>
    result.material.text.indexOf(m),
  );
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test("a table cell keeps a one-character or lone-symbol value", () => {
  const values = ["0", "1", "N", "✓", "-", "%"];
  const result = shape({
    title: "T",
    blocks: [
      ...values.map((text) => ({ kind: "table-cell", row: 1, text })),
      filler("body."),
    ],
  });
  assert.equal(result.ok, true);
  assert.match(result.material.text, /^0 \| 1 \| N \| ✓ \| - \| %$/m);
});

test("an empty or whitespace-only table cell is still dropped", () => {
  const result = shape({
    title: "T",
    blocks: [
      { kind: "table-cell", row: 1, text: "" },
      { kind: "table-cell", row: 1, text: " " + NBSP + " " },
      { kind: "table-cell", row: 1, text: "A" },
      filler("body."),
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.material.blockCount, 2);
});

test("one-character and symbol-only blocks of other kinds are still dropped", () => {
  const result = shape({
    title: "T",
    blocks: [
      { kind: "list-item", text: "x" },
      { kind: "quote", text: "—" },
      { kind: "heading", level: 2, text: "#" },
      { kind: "code", text: "}" },
      filler("body."),
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.material.blockCount, 1);
});

test("a newline exactly at the code budget does not push a piece over the limit", () => {
  const code = "x".repeat(92) + "\n" + "y".repeat(150);
  const chunks = chunkMaterial(
    { title: "", blocks: [{ kind: "code", text: code }] },
    100,
  );
  assert.ok(chunks.length >= 2);
  for (const chunk of chunks) assert.ok(chunk.charCount <= 100);
  const joined = chunks.flatMap((c) => c.blocks.map((b) => b.text)).join("");
  assert.equal(joined, code);
  assert.equal(joined.split("\n").length - 1, 1);
  assert.equal(joined.indexOf("\n"), 92);
});

test("a newline that fits within the code budget is still the preferred cut", () => {
  const code = "x".repeat(91) + "\n" + "y".repeat(150);
  const chunks = chunkMaterial(
    { title: "", blocks: [{ kind: "code", text: code }] },
    100,
  );
  assert.ok(chunks.length >= 2);
  assert.equal(chunks[0].blocks[0].text, "x".repeat(91) + "\n");
  for (const chunk of chunks) assert.ok(chunk.charCount <= 100);
  assert.equal(chunks.flatMap((c) => c.blocks.map((b) => b.text)).join(""), code);
});
