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
