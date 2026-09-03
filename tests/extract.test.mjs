import test from "node:test";
import assert from "node:assert/strict";

import { el, page, runExtract } from "./extract-fixture.mjs";
import { render } from "../src/shape/shape.js";

test("hidden text inside the declared root cannot select it, and never appears in a block", () => {
  const hiddenFiller = "Hidden filler content. ".repeat(20); // well past MIN_ROOT_CHARS
  const articleProse = "Visible article content, plenty of it. ".repeat(8); // >= 200 chars

  const doc = page([
    el("main", {}, [
      el("p", {}, ["Short main intro."]),
      el("div", { hidden: true }, [el("p", {}, [hiddenFiller])]),
    ]),
    el("article", {}, [el("p", {}, [articleProse])]),
  ]);

  const result = runExtract(doc);

  assert.ok(
    result.blocks.some((b) => b.text.includes("Visible article content")),
    "the article's eligible content should have been extracted",
  );
  for (const block of result.blocks) {
    assert.doesNotMatch(block.text, /Hidden filler/);
  }
});

test("a hidden main with too little visible text falls through to the fallback ladder", () => {
  const hiddenFiller = "x".repeat(1000);
  const doc = page([
    el("main", { hidden: true }, [el("p", {}, [hiddenFiller])]),
    el("article", {}, [
      el("p", {}, ["Real content readers can see. ".repeat(10)]),
    ]),
  ]);

  const result = runExtract(doc);

  assert.ok(result.blocks.some((b) => b.text.includes("Real content")));
  for (const block of result.blocks) {
    assert.doesNotMatch(block.text, /^x+$/);
  }
});

test("a nested list keeps the parent item's own text and the child item, in order, once each", () => {
  const doc = page([
    el("ul", {}, [
      el("li", {}, ["Parent", el("ul", {}, [el("li", {}, ["Child"])])]),
    ]),
  ]);

  const result = runExtract(doc);
  const items = result.blocks.filter((b) => b.kind === "list-item");

  assert.deepEqual(
    items.map((b) => b.text),
    ["Parent", "Child"],
  );
  for (const item of items) assert.equal(item.kind, "list-item");
});

test("a list item holding a paragraph keeps both texts as one list item, not a bare paragraph", () => {
  const doc = page([
    el("ul", {}, [
      el("li", {}, [
        "Parent explanation ",
        el("p", {}, ["Detailed explanation"]),
      ]),
    ]),
  ]);

  const result = runExtract(doc);
  const items = result.blocks.filter((b) => b.kind === "list-item");
  const paragraphs = result.blocks.filter((b) => b.kind === "paragraph");

  assert.equal(items.length, 1);
  assert.match(items[0].text, /Parent explanation/);
  assert.match(items[0].text, /Detailed explanation/);
  assert.ok(
    items[0].text.indexOf("Parent explanation") <
      items[0].text.indexOf("Detailed explanation"),
    "the parent's own text should come before the paragraph's",
  );
  assert.equal(paragraphs.length, 0, "the paragraph must not also be emitted on its own");
});

test("a blockquote holding a paragraph keeps quote semantics, not plain paragraph semantics", () => {
  const doc = page([
    el("blockquote", {}, [el("p", {}, ["Quoted text"])]),
  ]);

  const result = runExtract(doc);
  const quotes = result.blocks.filter((b) => b.kind === "quote");
  const paragraphs = result.blocks.filter((b) => b.kind === "paragraph");

  assert.equal(quotes.length, 1);
  assert.equal(quotes[0].text, "Quoted text");
  assert.equal(paragraphs.length, 0);
});

test("table cells holding a paragraph keep table-cell semantics and shared row identity", () => {
  const doc = page([
    el("table", {}, [
      el("tr", {}, [
        el("td", {}, [el("p", {}, ["Name"])]),
        el("td", {}, [el("p", {}, ["Value"])]),
      ]),
    ]),
  ]);

  const result = runExtract(doc);
  const cells = result.blocks.filter((b) => b.kind === "table-cell");

  assert.equal(cells.length, 2);
  assert.equal(cells[0].text, "Name");
  assert.equal(cells[1].text, "Value");
  assert.equal(cells[0].row, cells[1].row);
  assert.ok(cells[0].row > 0);

  const rendered = render(result.blocks);
  assert.match(rendered, /Name \| Value/);
});

test("a linked heading is kept as a heading, despite being entirely link text", () => {
  const doc = page([
    el("h2", {}, [el("a", { href: "/section" }, ["Installation"])]),
  ]);

  const result = runExtract(doc);
  const headings = result.blocks.filter((b) => b.kind === "heading");

  assert.equal(headings.length, 1);
  assert.equal(headings[0].level, 2);
  assert.equal(headings[0].text, "Installation");
});

test("a linked table cell is kept, despite being entirely link text", () => {
  const doc = page([
    el("table", {}, [
      el("tr", {}, [el("td", {}, [el("a", { href: "/status" }, ["Active"])])]),
    ]),
  ]);

  const result = runExtract(doc);
  const cells = result.blocks.filter((b) => b.kind === "table-cell");

  assert.equal(cells.length, 1);
  assert.equal(cells[0].text, "Active");
  assert.ok(cells[0].row > 0);
});

test("a link-dense list not wrapped in furniture is still dropped by link density", () => {
  const doc = page([
    el("ul", {}, [
      el("li", {}, [el("a", { href: "/a" }, ["Home"])]),
      el("li", {}, [el("a", { href: "/b" }, ["About"])]),
      el("li", {}, [el("a", { href: "/c" }, ["Contact"])]),
    ]),
  ]);

  const result = runExtract(doc);

  assert.equal(result.blocks.length, 0);
});

test("a list item mixing prose with a link is kept, since it is not link-dense", () => {
  const doc = page([
    el("ul", {}, [
      el("li", {}, [
        "See the ",
        el("a", { href: "/docs" }, ["documentation"]),
        " for details.",
      ]),
    ]),
  ]);

  const result = runExtract(doc);
  const items = result.blocks.filter((b) => b.kind === "list-item");

  assert.equal(items.length, 1);
  assert.match(items[0].text, /See the documentation for details\./);
});

test("hidden and furniture content is still excluded from block collection", () => {
  const doc = page([
    el("nav", {}, [el("p", {}, ["Navigation link text"])]),
    el("aside", {}, [el("p", {}, ["Related sidebar text"])]),
    el("p", { hidden: true }, ["Hidden paragraph text"]),
    el("p", {}, ["Ordinary visible paragraph."]),
  ]);

  const result = runExtract(doc);

  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].text, "Ordinary visible paragraph.");
});

test("non-content elements are excluded from block collection", () => {
  const doc = page([
    el("button", {}, [el("p", {}, ["Button label text"])]),
    el("p", {}, ["Ordinary visible paragraph."]),
  ]);

  const result = runExtract(doc);

  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].text, "Ordinary visible paragraph.");
});

test("the title prefers the root's first h1, which is not also emitted as a heading block", () => {
  const doc = page(
    [
      el("h1", {}, ["The Page Title"]),
      el("h2", {}, ["A Subheading"]),
      el("p", {}, ["Some body text."]),
    ],
    { title: "The Page Title - Some Site" },
  );

  const result = runExtract(doc);

  assert.equal(result.title, "The Page Title");
  const headingTexts = result.blocks
    .filter((b) => b.kind === "heading")
    .map((b) => b.text);
  assert.deepEqual(headingTexts, ["A Subheading"]);
});

test("without an h1, the title falls back to document.title", () => {
  const doc = page([el("p", {}, ["Some body text."])], {
    title: "Document Title Only",
  });

  const result = runExtract(doc);

  assert.equal(result.title, "Document Title Only");
});

test("heading level is kept for every level", () => {
  const doc = page([
    el("h1", {}, ["Title"]),
    el("h3", {}, ["A level-3 heading"]),
  ]);

  const result = runExtract(doc);
  const heading = result.blocks.find((b) => b.kind === "heading");

  assert.equal(heading.level, 3);
  assert.equal(heading.text, "A level-3 heading");
});

test("code text is preserved apart from a leading blank line and trailing whitespace", () => {
  const doc = page([
    el("pre", {}, ["\n\nfunction f() {\n  return 1;\n}\n  "]),
  ]);

  const result = runExtract(doc);
  const code = result.blocks.find((b) => b.kind === "code");

  assert.equal(code.text, "function f() {\n  return 1;\n}");
});

test("row identity never crosses two different tables", () => {
  const doc = page([
    el("table", {}, [
      el("tr", {}, [el("td", {}, [el("p", {}, ["A1"])]), el("td", {}, [el("p", {}, ["A2"])])]),
    ]),
    el("table", {}, [
      el("tr", {}, [el("td", {}, [el("p", {}, ["B1"])]), el("td", {}, [el("p", {}, ["B2"])])]),
    ]),
  ]);

  const result = runExtract(doc);
  const cells = result.blocks.filter((b) => b.kind === "table-cell");

  assert.equal(cells.length, 4);
  const rowsOfA = cells.filter((c) => c.text.startsWith("A")).map((c) => c.row);
  const rowsOfB = cells.filter((c) => c.text.startsWith("B")).map((c) => c.row);
  assert.equal(rowsOfA[0], rowsOfA[1]);
  assert.equal(rowsOfB[0], rowsOfB[1]);
  assert.notEqual(rowsOfA[0], rowsOfB[0]);
});

test("no URL is ever returned", () => {
  const doc = page([
    el("h2", {}, [el("a", { href: "/section" }, ["Installation"])]),
    el("p", {}, ["See ", el("a", { href: "https://example.com/x" }, ["here"]), " for more."]),
  ]);

  const result = runExtract(doc);

  assert.equal("url" in result, false);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /https?:\/\//);
  assert.doesNotMatch(serialized, /\/section/);
});
