import test from "node:test";
import assert from "node:assert/strict";

import { el, page, runExtract } from "./extract-fixture.mjs";
import { normalizeText, render, shape } from "../src/shape/shape.js";

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

test("a visible paragraph's hidden descendant text is excluded, and its visible text is kept", () => {
  const doc = page([
    el("p", {}, [
      "Visible lead-in. ",
      el("span", { hidden: true }, ["Hidden aside."]),
      " Visible close.",
    ]),
  ]);

  const result = runExtract(doc);
  const paragraphs = result.blocks.filter((b) => b.kind === "paragraph");

  assert.equal(paragraphs.length, 1);
  assert.match(paragraphs[0].text, /Visible lead-in\./);
  assert.match(paragraphs[0].text, /Visible close\./);
  assert.doesNotMatch(paragraphs[0].text, /Hidden aside/);
});

test("a visible heading's hidden descendant text is excluded, and its visible text is kept", () => {
  const doc = page([
    el("h2", {}, [
      "Visible heading text",
      el("span", { "aria-hidden": "true" }, [" (internal note)"]),
    ]),
  ]);

  const result = runExtract(doc);
  const headings = result.blocks.filter((b) => b.kind === "heading");

  assert.equal(headings.length, 1);
  assert.equal(headings[0].text, "Visible heading text");
  assert.doesNotMatch(headings[0].text, /internal note/);
});

test("a visible candidate's non-content descendant text is excluded", () => {
  const doc = page([
    el("p", {}, [
      "Visible prose. ",
      el("script", {}, ["trackEvent('should not appear');"]),
      el("button", {}, ["Click me"]),
    ]),
  ]);

  const result = runExtract(doc);
  const paragraphs = result.blocks.filter((b) => b.kind === "paragraph");

  assert.equal(paragraphs.length, 1);
  assert.equal(paragraphs[0].text, "Visible prose.");
  assert.doesNotMatch(paragraphs[0].text, /trackEvent/);
  assert.doesNotMatch(paragraphs[0].text, /Click me/);
});

test("a hidden h1 is never the title: a later visible h1 is preferred over it", () => {
  const doc = page(
    [
      el("h1", { hidden: true }, ["Hidden skip-link heading"]),
      el("h1", {}, ["Visible Page Title"]),
      el("p", {}, ["Some body text."]),
    ],
    { title: "Document Title - Some Site" },
  );

  const result = runExtract(doc);

  assert.equal(result.title, "Visible Page Title");
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /Hidden skip-link heading/);
});

test("a hidden h1 is never the title: document.title is preferred over it when no visible h1 exists", () => {
  const doc = page(
    [
      el("h1", { hidden: true }, ["Hidden skip-link heading"]),
      el("p", {}, ["Some body text."]),
    ],
    { title: "Document Title Only" },
  );

  const result = runExtract(doc);

  assert.equal(result.title, "Document Title Only");
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /Hidden skip-link heading/);
});

test("adjacent inline CJK text is not split by an artificial space", () => {
  const doc = page([
    el("li", {}, ["前", el("strong", {}, ["後"]), "。"]),
  ]);

  const result = runExtract(doc);
  const items = result.blocks.filter((b) => b.kind === "list-item");

  assert.equal(items.length, 1);
  assert.equal(items[0].text, "前後。");
});

test("an inline link followed directly by punctuation is not split by an artificial space", () => {
  const doc = page([
    el("li", {}, ["See ", el("a", { href: "/docs" }, ["docs"]), "."]),
  ]);

  const result = runExtract(doc);
  const items = result.blocks.filter((b) => b.kind === "list-item");

  assert.equal(items.length, 1);
  assert.equal(items[0].text, "See docs.");
});

test("a hidden descendant inside a pre does not leak into the code block, and visible line breaks are kept", () => {
  const doc = page([
    el("pre", {}, [
      "line one\n",
      el("span", { hidden: true }, ["secret line\n"]),
      "line two\n",
    ]),
  ]);

  const result = runExtract(doc);
  const code = result.blocks.find((b) => b.kind === "code");

  assert.equal(code.text, "line one\nline two");
  assert.doesNotMatch(code.text, /secret line/);
});

test("a non-content descendant inside a pre does not leak into the code block", () => {
  const doc = page([
    el("pre", {}, [
      "const x = 1;\n",
      el("script", {}, ["trackEvent('code viewed');"]),
      el("button", {}, ["Copy"]),
      "const y = 2;",
    ]),
  ]);

  const result = runExtract(doc);
  const code = result.blocks.find((b) => b.kind === "code");

  assert.equal(code.text, "const x = 1;\nconst y = 2;");
  assert.doesNotMatch(code.text, /trackEvent/);
  assert.doesNotMatch(code.text, /Copy/);
});

test("visibility: collapse is treated as not displayed, the same as visibility: hidden", () => {
  const doc = page([
    el("p", {}, [
      "Visible lead-in. ",
      el("span", { style: { visibility: "collapse" } }, ["Collapsed aside."]),
      " Visible close.",
    ]),
  ]);

  const result = runExtract(doc);
  const paragraphs = result.blocks.filter((b) => b.kind === "paragraph");

  assert.equal(paragraphs.length, 1);
  assert.match(paragraphs[0].text, /Visible lead-in\./);
  assert.match(paragraphs[0].text, /Visible close\./);
  assert.doesNotMatch(paragraphs[0].text, /Collapsed aside/);
});

test("a candidate that is itself visibility: collapse contributes no block", () => {
  const doc = page([
    el("p", { style: { visibility: "collapse" } }, ["Entirely collapsed text."]),
    el("p", {}, ["Ordinary visible paragraph."]),
  ]);

  const result = runExtract(doc);

  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].text, "Ordinary visible paragraph.");
});

test("an article-local header's title and introduction are kept, not thrown out as furniture", () => {
  const doc = page([
    el("article", {}, [
      el("header", {}, [
        el("h1", {}, ["Article Title"]),
        el(
          "p",
          {},
          ["Important introduction to the article, long enough to read. ".repeat(3)],
        ),
      ]),
      el("p", {}, ["Body paragraph text, also long enough on its own. ".repeat(6)]),
    ]),
  ]);

  const result = runExtract(doc);

  assert.equal(result.title, "Article Title");
  assert.ok(
    result.blocks.some((b) => b.text.includes("Important introduction")),
    "the header's own introduction should have been extracted",
  );
  assert.ok(result.blocks.some((b) => b.text.includes("Body paragraph text")));
  assert.equal(
    result.blocks.filter((b) => b.kind === "heading").length,
    0,
    "the title's own h1 must not also be emitted as a heading block",
  );
});

test("a page-level header outside any article/main/section is still excluded as furniture", () => {
  const doc = page([
    el("header", {}, [
      el("p", {}, ["Site navigation text that must never reach the body content."]),
    ]),
    el("p", {}, ["Real page content, long enough to stand as the body. ".repeat(5)]),
  ]);

  const result = runExtract(doc);

  assert.ok(result.blocks.some((b) => b.text.includes("Real page content")));
  for (const block of result.blocks) {
    assert.doesNotMatch(block.text, /Site navigation/);
  }
});

test("a <br> inside a paragraph is kept as a visible text boundary, not merged away", () => {
  const doc = page([el("p", {}, ["foo", el("br", {}), "bar"])]);

  const result = runExtract(doc);
  const paragraphs = result.blocks.filter((b) => b.kind === "paragraph");

  assert.equal(paragraphs.length, 1);
  assert.notEqual(paragraphs[0].text, "foobar");
  assert.match(paragraphs[0].text, /foo/);
  assert.match(paragraphs[0].text, /bar/);
});

test("a definition list's dt/dd direct text is preserved, in order, without duplication", () => {
  const doc = page([
    el("dl", {}, [
      el("dt", {}, ["Term"]),
      el("dd", {}, ["Definition of the term."]),
    ]),
  ]);

  const result = runExtract(doc);
  const paragraphs = result.blocks.filter((b) => b.kind === "paragraph");

  assert.deepEqual(
    paragraphs.map((b) => b.text),
    ["Term", "Definition of the term."],
  );
});

test("a figcaption's direct text is preserved as visible main content", () => {
  const doc = page([
    el("figure", {}, [
      el("img", { src: "photo.jpg" }),
      el("figcaption", {}, ["A caption describing the photo."]),
    ]),
  ]);

  const result = runExtract(doc);
  const paragraphs = result.blocks.filter((b) => b.kind === "paragraph");

  assert.deepEqual(
    paragraphs.map((b) => b.text),
    ["A caption describing the photo."],
  );
});

test("a generic wrapper's own direct text and a nested heading are both kept once, in DOM order", () => {
  const doc = page([
    el("div", {}, [
      "Intro text before the heading.",
      el("h2", {}, ["Section Heading"]),
      "Trailing text after the heading.",
    ]),
  ]);

  const result = runExtract(doc);

  assert.deepEqual(
    result.blocks.map((b) => [b.kind, b.text]),
    [
      ["paragraph", "Intro text before the heading."],
      ["heading", "Section Heading"],
      ["paragraph", "Trailing text after the heading."],
    ],
  );
});

test("a hidden descendant inside a non-candidate wrapper is excluded from its buffered direct text", () => {
  const doc = page([
    el("div", {}, [
      "Visible before.",
      el("span", { hidden: true }, ["Hidden middle."]),
      "Visible after.",
    ]),
  ]);

  const result = runExtract(doc);
  const paragraphs = result.blocks.filter((b) => b.kind === "paragraph");

  assert.equal(paragraphs.length, 1);
  assert.match(paragraphs[0].text, /Visible before\./);
  assert.match(paragraphs[0].text, /Visible after\./);
  assert.doesNotMatch(paragraphs[0].text, /Hidden middle/);
});

// `style: { display: "inline" }` stands in for the browser's own default
// rendering of `strong`/`em`/`span`/`a`: the fixture has no UA stylesheet,
// so an inline element is marked explicitly here the way a real page's
// `getComputedStyle` would already report it without any style attribute.
test("an inline element inside a non-candidate wrapper stays part of the surrounding prose", () => {
  const doc = page([
    el("div", {}, [
      "Hello ",
      el("strong", { style: { display: "inline" } }, ["world"]),
      "!",
    ]),
  ]);

  const result = runExtract(doc);

  assert.deepEqual(
    result.blocks.map((b) => [b.kind, b.text]),
    [["paragraph", "Hello world!"]],
  );
});

test("an inline link surrounded by prose in a non-candidate wrapper is kept, not dropped as link-dense", () => {
  const doc = page([
    el("div", {}, [
      "Read ",
      el("a", { href: "/docs", style: { display: "inline" } }, ["docs"]),
      ".",
    ]),
  ]);

  const result = runExtract(doc);
  const paragraphs = result.blocks.filter((b) => b.kind === "paragraph");

  assert.equal(paragraphs.length, 1);
  assert.equal(paragraphs[0].text, "Read docs.");
});

test("a non-candidate wrapper that is nothing but inline links is still dropped by link density", () => {
  const doc = page([
    el("div", {}, [
      el("a", { href: "/a", style: { display: "inline" } }, ["Home"]),
      " ",
      el("a", { href: "/b", style: { display: "inline" } }, ["About"]),
    ]),
  ]);

  const result = runExtract(doc);

  assert.equal(result.blocks.length, 0);
});

test("a hidden inline descendant inside a non-candidate wrapper is still excluded", () => {
  const doc = page([
    el("div", {}, [
      "Visible before ",
      el("strong", { style: { display: "inline" }, hidden: true }, ["Hidden"]),
      "visible after.",
    ]),
  ]);

  const result = runExtract(doc);
  const paragraphs = result.blocks.filter((b) => b.kind === "paragraph");

  assert.equal(paragraphs.length, 1);
  assert.match(paragraphs[0].text, /Visible before/);
  assert.match(paragraphs[0].text, /visible after\./);
  assert.doesNotMatch(paragraphs[0].text, /Hidden/);
});

test("an inline element does not split a non-candidate wrapper's prose from a following nested heading", () => {
  const doc = page([
    el("div", {}, [
      "Intro ",
      el("strong", { style: { display: "inline" } }, ["bold"]),
      " text.",
      el("h2", {}, ["Section Heading"]),
      "Trailing text.",
    ]),
  ]);

  const result = runExtract(doc);

  assert.deepEqual(
    result.blocks.map((b) => [b.kind, b.text]),
    [
      ["paragraph", "Intro bold text."],
      ["heading", "Section Heading"],
      ["paragraph", "Trailing text."],
    ],
  );
});

test("an inline element's own leading whitespace is preserved when absorbed into surrounding prose", () => {
  const doc = page([
    el("div", {}, [
      "Hello",
      el("strong", { style: { display: "inline" } }, [" world"]),
      "!",
    ]),
  ]);

  const result = runExtract(doc);

  assert.deepEqual(
    result.blocks.map((b) => [b.kind, b.text]),
    [["paragraph", "Hello world!"]],
  );
});

test("an inline element's own trailing whitespace is preserved when absorbed into surrounding prose", () => {
  const doc = page([
    el("div", {}, [
      el("span", { style: { display: "inline" } }, ["Hello "]),
      el("em", { style: { display: "inline" } }, ["world"]),
    ]),
  ]);

  const result = runExtract(doc);

  assert.deepEqual(
    result.blocks.map((b) => [b.kind, b.text]),
    [["paragraph", "Hello world"]],
  );
});

test("adjacent inline CJK text absorbed into surrounding prose gains no artificial space", () => {
  const doc = page([
    el("div", {}, [
      "前",
      el("strong", { style: { display: "inline" } }, ["後"]),
      "。",
    ]),
  ]);

  const result = runExtract(doc);

  assert.deepEqual(
    result.blocks.map((b) => [b.kind, b.text]),
    [["paragraph", "前後。"]],
  );
});

test("a candidate paragraph's inline child keeps its own leading whitespace", () => {
  const doc = page([el("p", {}, ["Hello", el("strong", {}, [" world"]), "!"])]);

  const result = runExtract(doc);
  const paragraphs = result.blocks.filter((b) => b.kind === "paragraph");

  assert.equal(paragraphs.length, 1);
  assert.equal(paragraphs[0].text, "Hello world!");
});

test("a candidate paragraph's inline child keeps its own trailing whitespace", () => {
  const doc = page([
    el("p", {}, [el("span", {}, ["Hello "]), el("em", {}, ["world"])]),
  ]);

  const result = runExtract(doc);
  const paragraphs = result.blocks.filter((b) => b.kind === "paragraph");

  assert.equal(paragraphs.length, 1);
  assert.equal(paragraphs[0].text, "Hello world");
});

test("adjacent inline CJK text inside a candidate paragraph gains no artificial space", () => {
  const doc = page([el("p", {}, ["前", el("strong", {}, ["後"]), "。"])]);

  const result = runExtract(doc);
  const paragraphs = result.blocks.filter((b) => b.kind === "paragraph");

  assert.equal(paragraphs.length, 1);
  assert.equal(paragraphs[0].text, "前後。");
});

test("the title candidate keeps an inline child's own leading whitespace, the same rule eligibleText applies elsewhere", () => {
  const doc = page([
    el("h1", {}, ["Hello", el("strong", {}, [" world"]), "!"]),
    el("p", {}, ["Body text, long enough to not matter here."]),
  ]);

  const result = runExtract(doc);

  assert.equal(result.title, "Hello world!");
});

test("a visible <br> inside a pre becomes a line break in the code text", () => {
  const doc = page([el("pre", {}, ["foo", el("br", {}), "bar"])]);

  const result = runExtract(doc);
  const code = result.blocks.find((b) => b.kind === "code");

  assert.equal(code.text, "foo\nbar");
});

test("an ancestor's visibility:hidden does not exclude a descendant with its own effective visibility:visible", () => {
  const doc = page([
    el("div", { style: { visibility: "hidden" } }, [
      el("p", { style: { visibility: "visible" } }, [
        "Overridden back to visible.",
      ]),
    ]),
  ]);

  const result = runExtract(doc);

  assert.ok(
    result.blocks.some((b) => b.text.includes("Overridden back to visible")),
  );
});

test("a descendant that inherits an ancestor's visibility:hidden without its own override is still excluded", () => {
  const doc = page([
    el("div", { style: { visibility: "hidden" } }, [
      el("p", { style: { visibility: "hidden" } }, ["Still hidden text."]),
    ]),
    el("p", {}, ["Ordinary visible paragraph. ".repeat(3)]),
  ]);

  const result = runExtract(doc);

  assert.ok(!result.blocks.some((b) => b.text.includes("Still hidden text")));
  assert.ok(
    result.blocks.some((b) => b.text.includes("Ordinary visible paragraph")),
  );
});

test("an ancestor's display:none excludes a descendant regardless of the descendant's own visibility", () => {
  const doc = page([
    el("div", { style: { display: "none" } }, [
      el("p", { style: { visibility: "visible" } }, ["Should stay hidden."]),
    ]),
    el("p", {}, ["Ordinary visible paragraph."]),
  ]);

  const result = runExtract(doc);

  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].text, "Ordinary visible paragraph.");
});

test("a display:contents wrapper does not split the surrounding prose into separate paragraphs", () => {
  const doc = page([
    el("div", {}, [
      "Hello ",
      el("span", { style: { display: "contents" } }, ["middle"]),
      " world",
    ]),
  ]);

  const result = runExtract(doc);

  assert.deepEqual(
    result.blocks.map((b) => [b.kind, b.text]),
    [["paragraph", "Hello middle world"]],
  );
});

test("a nested heading inside a display:contents wrapper is still its own independent block", () => {
  const doc = page([
    el("div", {}, [
      "Intro text.",
      el("span", { style: { display: "contents" } }, [
        el("h2", {}, ["Nested Heading"]),
      ]),
      "Trailing text.",
    ]),
  ]);

  const result = runExtract(doc);

  assert.deepEqual(
    result.blocks.map((b) => [b.kind, b.text]),
    [
      ["paragraph", "Intro text."],
      ["heading", "Nested Heading"],
      ["paragraph", "Trailing text."],
    ],
  );
});

test("a display:contents anchor's text counts as link characters, just like an ordinary inline anchor", () => {
  const ordinary = runExtract(
    page([
      el("div", {}, [
        el("a", { href: "/x", style: { display: "inline" } }, [
          "Link only text",
        ]),
      ]),
    ]),
  );
  const contents = runExtract(
    page([
      el("div", {}, [
        el("a", { href: "/x", style: { display: "contents" } }, [
          "Link only text",
        ]),
      ]),
    ]),
  );

  assert.deepEqual(ordinary.blocks, []);
  assert.deepEqual(contents.blocks, []);
});

test("mixed prose around a display:contents anchor still measures density from the anchor's own text", () => {
  const doc = page([
    el("div", {}, [
      "See ",
      el("a", { href: "/docs", style: { display: "contents" } }, [
        "x".repeat(50),
      ]),
      ".",
    ]),
  ]);

  const result = runExtract(doc);

  assert.deepEqual(result.blocks, []);
});

test("a display:contents anchor nested inside another display:contents wrapper keeps its anchor context", () => {
  const doc = page([
    el("div", {}, [
      el("span", { style: { display: "contents" } }, [
        el("a", { href: "/x", style: { display: "contents" } }, [
          "Link only text",
        ]),
      ]),
    ]),
  ]);

  const result = runExtract(doc);

  assert.deepEqual(result.blocks, []);
});

test("hidden text inside a display:contents anchor is excluded from both text and link character counts", () => {
  const doc = page([
    el("div", {}, [
      "Visible before ",
      el("a", { href: "/x", style: { display: "contents" } }, [
        "visible link ",
        el("span", { hidden: true }, ["secret"]),
      ]),
      "visible after.",
    ]),
  ]);

  const result = runExtract(doc);
  const paragraphs = result.blocks.filter((b) => b.kind === "paragraph");

  assert.equal(paragraphs.length, 1);
  assert.match(paragraphs[0].text, /Visible before/);
  assert.match(paragraphs[0].text, /visible link/);
  assert.match(paragraphs[0].text, /visible after/);
  assert.doesNotMatch(paragraphs[0].text, /secret/);
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

// ---- Root selection by retained content ----

function linkList(word, count) {
  const items = [];
  for (let i = 0; i < count; i++) {
    items.push(
      el("li", {}, [
        el("a", { href: `/${word}/${i}` }, [`${word} navigation entry number ${i} here`]),
      ]),
    );
  }
  return el("ul", {}, items);
}

const articleProse = (word) =>
  `${word} the substance of this article is carried by its sentences. `.repeat(5);

test("a main holding only a link list is not chosen over an article with real prose", () => {
  const doc = page([
    el("main", {}, [linkList("Linkmain", 10)]),
    el("article", {}, [el("p", {}, [articleProse("Articleprose")])]),
  ]);

  const result = runExtract(doc);
  const text = result.blocks.map((b) => b.text).join("\n");

  assert.match(text, /Articleprose/);
  assert.doesNotMatch(text, /Linkmain/);
});

test("a main whose retained prose is short is not rescued by its discarded links", () => {
  const doc = page([
    el("main", {}, [
      el("p", {}, ["Shortmain intro only."]),
      linkList("Linkmain", 10),
    ]),
    el("article", {}, [el("p", {}, [articleProse("Articleprose")])]),
  ]);

  const result = runExtract(doc);
  const text = result.blocks.map((b) => b.text).join("\n");

  assert.match(text, /Articleprose/);
  assert.doesNotMatch(text, /Shortmain/);
  assert.doesNotMatch(text, /Linkmain/);
});

test("a main with enough retained prose is still chosen and its link list is dropped", () => {
  const doc = page([
    el("main", {}, [
      el("p", {}, [articleProse("Mainprose")]),
      linkList("Linkmain", 10),
    ]),
    el("article", {}, [el("p", {}, [articleProse("Articleprose")])]),
  ]);

  const result = runExtract(doc);
  const text = result.blocks.map((b) => b.text).join("\n");

  assert.match(text, /Mainprose/);
  assert.doesNotMatch(text, /Articleprose/);
  assert.doesNotMatch(text, /Linkmain/);
});

test("a long linked heading counts as retained content, so the main is still chosen", () => {
  const heading = `Linkedheading ${"a long linked heading carries its own words ".repeat(6)}`;
  const doc = page([
    el("main", {}, [el("h2", {}, [el("a", { href: "/h" }, [heading])])]),
    el("article", {}, [el("p", {}, [articleProse("Articleprose")])]),
  ]);

  const result = runExtract(doc);
  const headings = result.blocks.filter((b) => b.kind === "heading");

  assert.equal(headings.length, 1);
  assert.match(headings[0].text, /Linkedheading/);
  assert.doesNotMatch(result.blocks.map((b) => b.text).join("\n"), /Articleprose/);
});

test("the title h1 does not count toward the retained content that adopts a root", () => {
  const doc = page([
    el("main", {}, [
      el("h1", {}, [`Titleword ${"a very long page title ".repeat(12)}`]),
      el("p", {}, ["Shortmain intro only."]),
    ]),
    el("article", {}, [el("p", {}, [articleProse("Articleprose")])]),
  ]);

  const result = runExtract(doc);
  const text = result.blocks.map((b) => b.text).join("\n");

  assert.match(text, /Articleprose/);
  assert.doesNotMatch(text, /Shortmain/);
});

test("extraction feeds shaping with the first code line's indentation intact", () => {
  const doc = page([
    el("main", {}, [
      el("p", {}, [articleProse("Mainprose")]),
      el("pre", {}, ["    first()\n        second()"]),
    ]),
  ]);

  const result = shape(runExtract(doc));

  assert.equal(result.ok, true);
  const code = result.material.blocks.find((b) => b.kind === "code");
  assert.equal(code.text, "    first()\n        second()");
  assert.ok(result.material.text.includes("    first()\n        second()"));
});

const INLINE = { display: "inline" };

test("an inline link wrapping a heading keeps the heading once, in order, with its prose", () => {
  const doc = page([
    el("div", {}, [
      "Before the link. ",
      el("a", { href: "/s", style: INLINE }, [el("h2", {}, ["Section"])]),
      "After the link.",
    ]),
  ]);

  const result = runExtract(doc);

  assert.deepEqual(
    result.blocks.map((b) => [b.kind, b.level, b.text]),
    [
      ["paragraph", undefined, "Before the link."],
      ["heading", 2, "Section"],
      ["paragraph", undefined, "After the link."],
    ],
  );
});

test("an inline link's own text beside a nested heading is kept and not duplicated", () => {
  const doc = page([
    el("div", {}, [
      "Plain prose leads the line, ",
      el("a", { href: "/s", style: INLINE }, [
        "read more: ",
        el("h3", {}, ["Details"]),
      ]),
    ]),
  ]);

  const result = runExtract(doc);

  assert.deepEqual(
    result.blocks.map((b) => [b.kind, b.text]),
    [
      ["paragraph", "Plain prose leads the line, read more:"],
      ["heading", "Details"],
    ],
  );
});

test("an h1 inside an inline link is the title and is not emitted again", () => {
  const doc = page(
    [
      el("div", {}, [
        el("a", { href: "/", style: INLINE }, [el("h1", {}, ["Linked Title"])]),
        el("h2", {}, ["Sub"]),
      ]),
    ],
    { title: "Linked Title - Site" },
  );

  const result = runExtract(doc);

  assert.equal(result.title, "Linked Title");
  assert.deepEqual(
    result.blocks.map((b) => [b.kind, b.text]),
    [["heading", "Sub"]],
  );
});

test("a hidden heading inside an inline link is still excluded", () => {
  const doc = page([
    el("div", {}, [
      "Visible prose.",
      el("a", { href: "/s", style: INLINE }, [
        el("h2", { hidden: true }, ["Hidden Section"]),
      ]),
    ]),
  ]);

  const result = runExtract(doc);

  assert.deepEqual(
    result.blocks.map((b) => [b.kind, b.text]),
    [["paragraph", "Visible prose."]],
  );
});

test("a link-dense run of inline links without headings is still dropped", () => {
  const doc = page([
    el("div", {}, [
      el("a", { href: "/a", style: INLINE }, ["Alpha"]),
      el("a", { href: "/b", style: INLINE }, ["Beta"]),
    ]),
  ]);

  assert.deepEqual(runExtract(doc).blocks, []);
});

const hiddenStyle = { visibility: "hidden" };
const visibleStyle = { visibility: "visible", display: "inline" };

function visibleBreakRun() {
  return [
    el("span", { style: visibleStyle }, ["Alpha"]),
    el("br", { style: visibleStyle }),
    el("span", { style: visibleStyle }, ["Beta"]),
  ];
}

test("a visible <br> under a hidden container keeps its break", () => {
  const doc = page([el("div", { style: hiddenStyle }, visibleBreakRun())]);

  const texts = runExtract(doc).blocks.map((b) => b.text);

  assert.deepEqual(texts, ["Alpha\nBeta"]);
});

test("a visible <br> under a hidden paragraph keeps its break", () => {
  const doc = page([el("p", { style: hiddenStyle }, visibleBreakRun())]);

  const texts = runExtract(doc).blocks.map((b) => b.text);

  assert.deepEqual(texts, ["Alpha\nBeta"]);
});

test("a visible <br> under hidden owned text keeps its break", () => {
  const doc = page([
    el("li", { style: hiddenStyle }, [
      ...visibleBreakRun(),
      el("ul", {}, [el("li", {}, ["Nested item"])]),
    ]),
  ]);

  const texts = runExtract(doc).blocks.map((b) => b.text);

  assert.ok(texts.includes("Alpha\nBeta"), JSON.stringify(texts));
  assert.ok(texts.includes("Nested item"));
});

test("a visible <br> under a hidden pre keeps its break", () => {
  const doc = page([
    el("pre", { style: hiddenStyle }, [
      el("span", { style: visibleStyle }, ["  Alpha"]),
      el("br", { style: visibleStyle }),
      el("span", { style: visibleStyle }, ["  Beta"]),
    ]),
  ]);

  const code = runExtract(doc).blocks.find((b) => b.kind === "code");

  assert.equal(code.text, "  Alpha\n  Beta");
});

test("a hidden or excluded <br> is still dropped", () => {
  const cases = [
    el("br", { style: hiddenStyle }),
    el("br", { style: { visibility: "collapse" } }),
    el("br", { style: { display: "none" } }),
    el("br", { hidden: true }),
    el("br", { "aria-hidden": "true" }),
  ];
  for (const brk of cases) {
    for (const parentStyle of [hiddenStyle, visibleStyle]) {
      const doc = page([
        el("div", { style: parentStyle }, [
          el("span", { style: visibleStyle }, ["Alpha"]),
          brk,
          el("span", { style: visibleStyle }, ["Beta"]),
        ]),
      ]);
      const texts = runExtract(doc).blocks.map((b) => b.text);
      assert.deepEqual(texts, ["AlphaBeta"]);
    }
  }
});

// --- a candidate root's own exclusion, and content-visibility: hidden ---

// Both are well past MIN_ROOT_CHARS.
const LONG_HIDDEN = "Hidden direct text that nobody can see. ".repeat(8);
const LONG_VISIBLE = "Visible article content, plenty of it. ".repeat(8);

function assertNoHidden(result) {
  for (const block of result.blocks) {
    assert.doesNotMatch(block.text, /Hidden|SECRET/);
  }
}

for (const [name, attrs] of [
  ["hidden", { hidden: true }],
  ['aria-hidden="true"', { "aria-hidden": "true" }],
  ["display:none", { style: { display: "none" } }],
]) {
  test(`a ${name} main with direct text neither is selected nor contributes blocks`, () => {
    const doc = page([
      el("main", attrs, [LONG_HIDDEN]),
      el("article", {}, [el("p", {}, [LONG_VISIBLE])]),
    ]);
    const result = runExtract(doc);
    assertNoHidden(result);
    assert.ok(result.blocks.some((b) => b.text.includes("Visible article")));
  });
}

test("a hidden role=main with direct text does not outrank a visible article", () => {
  const doc = page([
    el("div", { role: "main", hidden: true }, [LONG_HIDDEN]),
    el("article", {}, [el("p", {}, [LONG_VISIBLE])]),
  ]);
  const result = runExtract(doc);
  assertNoHidden(result);
  assert.ok(result.blocks.some((b) => b.text.includes("Visible article")));
});

test("mixed-case aria-hidden on a declared root does not select or emit it", () => {
  for (const value of ["TRUE", "True", "tRuE"]) {
    const doc = page([
      el("main", { "aria-hidden": value }, [LONG_HIDDEN]),
      el("article", {}, [el("p", {}, [LONG_VISIBLE])]),
    ]);
    const result = runExtract(doc);
    assertNoHidden(result);
    assert.ok(result.blocks.some((b) => b.text.includes("Visible article")));
  }
});

test("a mixed-case aria-hidden ancestor excludes its descendants", () => {
  const doc = page([
    el("main", {}, [
      el("p", {}, [LONG_VISIBLE]),
      el("section", { "aria-hidden": "tRuE" }, [
        "SECRET direct text",
        el("p", { "aria-hidden": "false" }, ["SECRET paragraph".repeat(20)]),
      ]),
    ]),
  ]);
  const result = runExtract(doc);
  assertNoHidden(result);
  assert.ok(result.blocks.some((b) => b.text.includes("Visible article")));
});

test("non-true aria-hidden values do not suppress visible content", () => {
  for (const value of ["false", "FALSE", "undefined"]) {
    const doc = page([el("main", { "aria-hidden": value }, [LONG_VISIBLE])]);
    const result = runExtract(doc);
    assert.ok(result.blocks.some((b) => b.text.includes("Visible article")));
  }
});

test("a visible main with direct text is still selected, and a hidden child alone does not exclude it", () => {
  const doc = page([
    el("main", {}, [LONG_VISIBLE, el("span", { hidden: true }, ["SECRET"])]),
  ]);
  const result = runExtract(doc);
  assertNoHidden(result);
  assert.ok(result.blocks.some((b) => b.text.includes("Visible article")));
});

test("a hidden body yields no blocks from its direct text", () => {
  const doc = page([LONG_HIDDEN]);
  doc.body._computedStyle = { display: "none" };
  assert.deepEqual(runExtract(doc).blocks, []);
});

const CV_HIDDEN = { contentVisibility: "hidden" };

test("content-visibility:hidden content is excluded from every block kind, visible siblings are kept", () => {
  const doc = page([
    el("main", {}, [
      el("section", {}, [el("p", {}, [LONG_VISIBLE])]),
      el("section", { style: CV_HIDDEN }, [
        el("h2", {}, ["SECRET heading"]),
        el("p", {}, ["SECRET paragraph. ".repeat(20)]),
        el("pre", {}, ["SECRET code"]),
        el("ul", {}, [el("li", {}, ["SECRET item"])]),
        el("table", {}, [el("tr", {}, [el("td", {}, ["SECRET cell"])])]),
        "SECRET loose text",
        el("div", { style: { visibility: "visible" } }, [
          el("p", { style: { visibility: "visible" } }, ["SECRET override"]),
        ]),
      ]),
    ]),
  ]);
  const result = runExtract(doc);
  assertNoHidden(result);
  assert.ok(result.blocks.some((b) => b.text.includes("Visible article")));
});

test("content-visibility:hidden on a candidate itself excludes its own text", () => {
  const doc = page([
    el("main", {}, [
      el("p", {}, [LONG_VISIBLE]),
      el("p", { style: CV_HIDDEN }, ["SECRET own text"]),
      el("h2", { style: CV_HIDDEN }, ["SECRET own heading"]),
    ]),
  ]);
  const result = runExtract(doc);
  assertNoHidden(result);
  assert.equal(result.blocks.length, 1);
});

test("content-visibility visible and auto are not treated as hidden", () => {
  for (const value of ["visible", "auto"]) {
    const doc = page([
      el("main", {}, [
        el("section", { style: { contentVisibility: value } }, [
          el("p", {}, [LONG_VISIBLE]),
        ]),
      ]),
    ]);
    const result = runExtract(doc);
    assert.ok(
      result.blocks.some((b) => b.text.includes("Visible article")),
      `content-visibility:${value} should stay extracted`,
    );
  }
});

test("a content-visibility:hidden main with direct text is not selected over a visible article", () => {
  const doc = page([
    el("main", { style: CV_HIDDEN }, [LONG_HIDDEN]),
    el("article", {}, [el("p", {}, [LONG_VISIBLE])]),
  ]);
  const result = runExtract(doc);
  assertNoHidden(result);
  assert.ok(result.blocks.some((b) => b.text.includes("Visible article")));
});

test("content-visibility:hidden text does not win the fallback root scoring", () => {
  const doc = page([
    el("div", { style: CV_HIDDEN }, [
      el("p", {}, ["SECRET scoring text. ".repeat(60)]),
    ]),
    el("div", {}, [el("p", {}, [LONG_VISIBLE])]),
  ]);
  const result = runExtract(doc);
  assertNoHidden(result);
  assert.ok(result.blocks.some((b) => b.text.includes("Visible article")));
});

test("a content-visibility:hidden ancestor of the declared root removes its content", () => {
  const doc = page([
    el("div", { style: CV_HIDDEN }, [
      el("main", {}, [el("p", {}, ["SECRET nested main. ".repeat(20)])]),
    ]),
    el("article", {}, [el("p", {}, [LONG_VISIBLE])]),
  ]);
  const result = runExtract(doc);
  assertNoHidden(result);
  assert.ok(result.blocks.some((b) => b.text.includes("Visible article")));
});

// --- collapsed details, paragraph boundaries and nested reading order ---

function texts(result, kind) {
  return result.blocks
    .filter((b) => kind === undefined || b.kind === kind)
    .map((b) => normalizeText(b.text));
}

const SECRET_BODY = "SECRET collapsed body text. ".repeat(12); // >= 200

test("a closed details keeps its visible summary and drops everything else", () => {
  const doc = page([
    el("main", {}, [
      el("p", {}, [LONG_VISIBLE]),
      el("details", {}, [
        el("summary", {}, ["Visible summary label"]),
        "SECRET direct text",
        el("p", {}, [SECRET_BODY]),
        el("h2", {}, ["SECRET heading"]),
        el("ul", {}, [el("li", {}, ["SECRET item"])]),
        el("pre", { style: { visibility: "visible" } }, ["SECRET code"]),
        el(
          "p",
          { "aria-hidden": "false", style: { contentVisibility: "visible" } },
          ["SECRET override"],
        ),
        el("table", {}, [el("tr", {}, [el("td", {}, ["SECRET cell"])])]),
      ]),
    ]),
  ]);
  const result = runExtract(doc);
  assertNoHidden(result);
  assert.ok(
    result.blocks.some((b) => b.text.includes("Visible summary label")),
  );
  assert.ok(result.blocks.some((b) => b.text.includes("Visible article")));
});

test("only the first direct summary of a closed details is shown, also when nested", () => {
  const doc = page([
    el("main", {}, [
      el("p", {}, [LONG_VISIBLE]),
      el("details", { open: "" }, [
        el("summary", {}, ["Outer summary"]),
        el("p", {}, ["Open outer body"]),
        el("details", {}, [
          el("summary", {}, ["Inner summary"]),
          el("summary", {}, ["SECRET second summary"]),
          el("p", {}, ["SECRET inner body"]),
        ]),
      ]),
    ]),
  ]);
  const result = runExtract(doc);
  assertNoHidden(result);
  const all = texts(result).join("|");
  assert.match(all, /Outer summary/);
  assert.match(all, /Open outer body/);
  assert.match(all, /Inner summary/);
});

test("an opened details, open=\"false\" included, keeps its body", () => {
  for (const open of ["", "open", "false"]) {
    const doc = page([
      el("main", {}, [
        el("p", {}, [LONG_VISIBLE]),
        el("details", { open }, [
          el("summary", {}, ["Opened summary"]),
          el("p", {}, ["Opened body paragraph"]),
          el("h3", {}, ["Opened heading"]),
          "Opened direct text",
        ]),
      ]),
    ]);
    const all = texts(runExtract(doc)).join("|");
    assert.match(all, /Opened summary/, `open=${JSON.stringify(open)}`);
    assert.match(all, /Opened body paragraph/);
    assert.match(all, /Opened heading/);
    assert.match(all, /Opened direct text/);
  }
});

test("closed details text does not decide the declared root or the scoring", () => {
  const closed = () =>
    el("details", {}, [
      el("summary", {}, ["Short label"]),
      el("p", {}, [SECRET_BODY]),
      el("pre", { style: { visibility: "visible" } }, [
        "SECRET code " + "x".repeat(300),
      ]),
    ]);
  const declared = page([
    el("main", {}, [closed()]),
    el("article", {}, [el("p", {}, [LONG_VISIBLE])]),
  ]);
  const declaredResult = runExtract(declared);
  assertNoHidden(declaredResult);
  assert.ok(
    declaredResult.blocks.some((b) => b.text.includes("Visible article")),
  );

  const scored = page([
    el("div", {}, [el("p", {}, ["Tiny visible."]), closed()]),
    el("div", {}, [el("p", {}, [LONG_VISIBLE])]),
  ]);
  const scoredResult = runExtract(scored);
  assertNoHidden(scoredResult);
  assert.ok(
    scoredResult.blocks.some((b) => b.text.includes("Visible article")),
  );
});

test("paragraphs inside a quote, list item and table cells keep a boundary", () => {
  const doc = page([
    el("blockquote", {}, [el("p", {}, ["Alpha"]), el("p", {}, ["Beta"])]),
    el("ul", {}, [
      el("li", {}, [el("p", {}, ["First"]), el("p", {}, ["Second"])]),
    ]),
    el("table", {}, [
      el("tr", {}, [
        el("th", {}, [el("p", {}, ["Head one"]), el("p", {}, ["Head two"])]),
        el("td", {}, [el("p", {}, ["Cell one"]), el("p", {}, ["Cell two"])]),
      ]),
    ]),
  ]);
  const result = runExtract(doc);
  assert.deepEqual(
    result.blocks.map((b) => [b.kind, normalizeText(b.text)]),
    [
      ["quote", "Alpha Beta"],
      ["list-item", "First Second"],
      ["table-cell", "Head one Head two"],
      ["table-cell", "Cell one Cell two"],
    ],
  );
  assert.deepEqual(
    result.blocks.filter((b) => b.kind === "table-cell").map((b) => b.row),
    [1, 1],
  );
});

test("a container's direct text and its paragraphs are separated, inline adjacency is not", () => {
  const doc = page([
    el("blockquote", {}, ["Alpha", el("p", {}, ["Beta"]), "Gamma"]),
    el("ul", {}, [
      el("li", {}, ["Hello", el("strong", {}, [" world"])]),
      el("li", {}, ["前", el("strong", {}, ["後"]), "。"]),
      el("li", {}, ["Read the ", el("a", {}, ["docs"]), "."]),
      el("li", {}, ["foo", el("br"), "bar"]),
      el("li", {}, [
        el("p", {}, ["One"]),
        "\n",
        el("p", {}, ["Two"]),
        el("p", {}, []),
      ]),
    ]),
  ]);
  const result = runExtract(doc);
  assert.deepEqual(texts(result), [
    "Alpha Beta Gamma",
    "Hello world",
    "前後。",
    "Read the docs.",
    "foo bar",
    "One Two",
  ]);
  assert.equal(result.blocks[0].text.includes("AlphaBeta"), false);
  assert.ok(result.blocks[4].text.includes("\n"));
});

test("a nested list item splits its parent's text in reading order", () => {
  const doc = page([
    el("ul", {}, [
      el("li", {}, [
        "Before",
        el("ul", {}, [el("li", {}, ["Child"])]),
        "After",
      ]),
    ]),
  ]);
  const result = runExtract(doc);
  assert.deepEqual(
    result.blocks.map((b) => [b.kind, b.text]),
    [
      ["list-item", "Before"],
      ["list-item", "Child"],
      ["list-item", "After"],
    ],
  );
});

test("a nested quote or heading inside a container keeps the parent's later text after it", () => {
  const doc = page([
    el("blockquote", {}, [
      "Outer before",
      el("blockquote", {}, ["Inner"]),
      "Outer after",
    ]),
    el("ul", {}, [
      el("li", {}, ["Lead", el("h3", {}, ["Embedded heading"]), "Trail"]),
    ]),
  ]);
  const result = runExtract(doc);
  assert.deepEqual(
    result.blocks.map((b) => [b.kind, b.text]),
    [
      ["quote", "Outer before"],
      ["quote", "Inner"],
      ["quote", "Outer after"],
      ["list-item", "Lead"],
      ["heading", "Embedded heading"],
      ["list-item", "Trail"],
    ],
  );
});

test("a container with a nested item but no later text keeps its earlier output", () => {
  const doc = page([
    el("ul", {}, [
      el("li", {}, ["Parent", el("ul", {}, [el("li", {}, ["Child"])])]),
      el("li", {}, ["Plain"]),
    ]),
  ]);
  assert.deepEqual(texts(runExtract(doc)), ["Parent", "Child", "Plain"]);
});

test("an empty paragraph between texts adds no boundary", () => {
  const doc = page([
    el("blockquote", {}, ["Alpha", el("p", {}, []), "Beta"]),
    el("blockquote", {}, [
      "Gamma",
      el("p", { hidden: true }, ["SECRET"]),
      el("p", { style: { visibility: "hidden" } }, ["SECRET"]),
      "Delta",
    ]),
  ]);
  const result = runExtract(doc);
  assert.deepEqual(
    result.blocks.map((b) => b.text),
    ["AlphaBeta", "GammaDelta"],
  );
});

test("link text after a nested list stays with its container", () => {
  const doc = page([
    el("ul", {}, [
      el("li", {}, [
        "Some detailed text before child.",
        el("ul", {}, [el("li", {}, ["Nested item!"])]),
        el("a", { href: "/docs" }, ["Documentation"]),
      ]),
    ]),
  ]);
  const result = runExtract(doc);
  assert.deepEqual(
    result.blocks.map((b) => [b.kind, b.text]),
    [
      ["list-item", "Some detailed text before child."],
      ["list-item", "Nested item!"],
      ["list-item", "Documentation"],
    ],
  );
});

test("a container made of links is still dropped as a whole around a nested item", () => {
  const doc = page([
    el("ul", {}, [
      el("li", {}, [
        el("a", { href: "/a" }, ["First link"]),
        el("ul", {}, [el("li", {}, ["Nested item!"])]),
        el("a", { href: "/b" }, ["Second link"]),
      ]),
    ]),
  ]);
  assert.deepEqual(texts(runExtract(doc)), ["Nested item!"]);
});

// --- link context from an enclosing anchor ---

const BLOCK = { display: "block" };
const CONTENTS = { display: "contents" };
const ROOT_PROSE =
  "Rootprose keeps the declared main above the acceptance floor. ".repeat(4);

// Each fragment is placed after enough prose for the declared main to be
// accepted, so every case is judged inside the same fixed root. The blocks
// that follow the prose are returned.
function extractInMain(children) {
  const doc = page([
    el("main", {}, [el("p", {}, [ROOT_PROSE]), ...children]),
  ]);
  const result = runExtract(doc);
  assert.deepEqual(result.blocks[0], {
    kind: "paragraph",
    text: ROOT_PROSE.trim(),
  });
  return result.blocks.slice(1);
}

function pairs(blocks) {
  return blocks.map((b) => [b.kind, b.text]);
}

test("a paragraph inside a block-display anchor is dropped as link text", () => {
  const blocks = extractInMain([
    el("a", { href: "/promo", style: BLOCK }, [
      el("p", {}, ["Promotional text"]),
    ]),
    el("a", { href: "/promo", style: BLOCK }, [
      el("div", { style: BLOCK }, [el("p", {}, ["Wrapped promotional text"])]),
    ]),
    el("p", {}, ["Ordinary prose after it."]),
  ]);
  assert.deepEqual(pairs(blocks), [["paragraph", "Ordinary prose after it."]]);
});

test("a paragraph inside a contents or inline anchor is dropped as link text", () => {
  const blocks = extractInMain([
    el("a", { href: "/promo", style: CONTENTS }, [
      el("p", {}, ["Contents promotional text"]),
    ]),
    el("a", { href: "/promo", style: INLINE }, [
      el("h2", {}, ["Linked section"]),
      el("p", {}, ["Inline promotional text"]),
    ]),
    el("a", { href: "/promo", style: INLINE }, [
      el("p", {}, ["Absorbed promotional text"]),
    ]),
    el("p", {}, ["Ordinary prose after it."]),
  ]);
  assert.deepEqual(blocks, [
    { kind: "heading", level: 2, text: "Linked section" },
    { kind: "paragraph", text: "Ordinary prose after it." },
  ]);
});

test("a list item inside an anchor is dropped as link text, ordinary items are kept", () => {
  const blocks = extractInMain([
    el("a", { href: "/a", style: BLOCK }, [
      el("ul", {}, [el("li", {}, ["Block anchor item"])]),
    ]),
    el("a", { href: "/b", style: CONTENTS }, [
      el("ul", {}, [el("li", {}, ["Contents anchor item"])]),
    ]),
    el("a", { href: "/c", style: INLINE }, [
      el("ul", {}, [el("li", {}, ["Inline anchor item"])]),
    ]),
    el("ul", {}, [
      el("li", {}, [
        "Ordinary parent item",
        el("a", { href: "/d", style: BLOCK }, [
          el("ul", {}, [el("li", {}, ["Linked child item"])]),
        ]),
      ]),
      el("li", {}, ["Ordinary sibling item"]),
    ]),
  ]);
  assert.deepEqual(pairs(blocks), [
    ["list-item", "Ordinary parent item"],
    ["list-item", "Ordinary sibling item"],
  ]);
});

test("link density inside a paragraph and a list item keeps its threshold", () => {
  const blocks = extractInMain([
    el("p", {}, [el("a", { href: "/a" }, ["Promotional text"])]),
    el("p", {}, ["XXX", el("a", { href: "/b" }, ["LLLLLLL"])]),
    el("p", {}, ["XXXX", el("a", { href: "/c" }, ["LLLLLL"])]),
    el("ul", {}, [
      el("li", {}, ["YYY", el("a", { href: "/d" }, ["MMMMMMM"])]),
      el("li", {}, ["YYYY", el("a", { href: "/e" }, ["MMMMMM"])]),
    ]),
  ]);
  assert.deepEqual(pairs(blocks), [
    ["paragraph", "XXXXLLLLLL"],
    ["list-item", "YYYYMMMMMM"],
  ]);
});

const LONG_LINKED_HEADING = `Linkedheading ${"words of a long linked heading ".repeat(7)}`.trim();

function mainFragment() {
  return el("main", {}, [
    "Main direct text",
    el("h2", {}, [LONG_LINKED_HEADING]),
    el("p", {}, ["Main paragraph"]),
    el("ul", {}, [el("li", {}, ["Main item"])]),
  ]);
}

test("a main wholly inside an anchor keeps its exempt heading and drops its linked prose", () => {
  const doc = page([
    el("a", { href: "/whole", style: BLOCK }, [mainFragment()]),
    el("article", {}, [el("p", {}, [articleProse("Articleprose")])]),
  ]);
  const result = runExtract(doc);
  assert.deepEqual(result.blocks, [
    { kind: "heading", level: 2, text: LONG_LINKED_HEADING },
  ]);

  const control = runExtract(
    page([
      mainFragment(),
      el("article", {}, [el("p", {}, [articleProse("Articleprose")])]),
    ]),
  );
  assert.deepEqual(pairs(control.blocks), [
    ["paragraph", "Main direct text"],
    ["heading", LONG_LINKED_HEADING],
    ["paragraph", "Main paragraph"],
    ["list-item", "Main item"],
  ]);
});

test("headings, quotes, code and table cells inside an anchor are not dropped for link density", () => {
  const blocks = extractInMain([
    el("a", { href: "/x", style: BLOCK }, [
      el("h3", {}, ["Linked heading"]),
      el("blockquote", {}, ["Linked quote"]),
      el("pre", {}, ["  linked code\n    indented"]),
      el("table", {}, [
        el("tr", {}, [
          el("td", {}, ["Linked cell"]),
          el("td", {}, ["Other cell"]),
        ]),
      ]),
    ]),
  ]);
  assert.deepEqual(blocks, [
    { kind: "heading", level: 3, text: "Linked heading" },
    { kind: "quote", text: "Linked quote" },
    { kind: "code", text: "  linked code\n    indented" },
    { kind: "table-cell", row: 1, text: "Linked cell" },
    { kind: "table-cell", row: 1, text: "Other cell" },
  ]);

  const titled = runExtract(
    page([
      el("a", { href: "/t", style: BLOCK }, [
        el("main", {}, [
          el("h1", {}, ["Linked title"]),
          el("h2", {}, [LONG_LINKED_HEADING]),
        ]),
      ]),
    ]),
  );
  assert.equal(titled.title, "Linked title");
  assert.deepEqual(titled.blocks, [
    { kind: "heading", level: 2, text: LONG_LINKED_HEADING },
  ]);
});

test("a link-dense container drops all its parts and keeps its nested unit", () => {
  const blocks = extractInMain([
    el("a", { href: "/a", style: BLOCK }, [
      el("ul", {}, [
        el("li", {}, [
          "Linked lead",
          el("h3", {}, ["Nested heading"]),
          "Linked tail",
        ]),
      ]),
    ]),
    el("ul", {}, [
      el("li", {}, [
        "A good deal of ordinary prose comes first.",
        el("ul", {}, [el("li", {}, ["Child item"])]),
        el("a", { href: "/c" }, ["Last"]),
      ]),
    ]),
  ]);
  assert.deepEqual(pairs(blocks), [
    ["heading", "Nested heading"],
    ["list-item", "A good deal of ordinary prose comes first."],
    ["list-item", "Child item"],
    ["list-item", "Last"],
  ]);
});

test("hidden text counts neither as content nor as link text", () => {
  const blocks = extractInMain([
    el("p", {}, [
      "Prose",
      el("a", { href: "/a" }, [
        "Lk",
        el("span", { hidden: true }, ["HIDDENLINKHIDDENLINK"]),
      ]),
    ]),
    el("p", {}, [
      el("a", { href: "/b" }, ["Linktext"]),
      el("span", { hidden: true }, ["HIDDENPROSEHIDDENPROSE"]),
    ]),
    el("a", { href: "/c", style: BLOCK }, [
      el("p", {}, [
        "Linked",
        el("span", { hidden: true }, ["HIDDENPROSEHIDDENPROSE"]),
      ]),
    ]),
  ]);
  assert.deepEqual(pairs(blocks), [["paragraph", "ProseLk"]]);
});

test("short block runs that are all link text stay link-dense after their boundaries", () => {
  const runs = (letters) =>
    letters.map((letter) => el("div", { style: BLOCK }, [letter]));
  const blocks = extractInMain([
    el("ul", {}, [
      el("li", {}, [el("a", { href: "/a", style: BLOCK }, runs(["A", "B", "C", "D"]))]),
      el("li", {}, [
        el("a", { href: "/b", style: BLOCK }, runs(["E"])),
        el("a", { href: "/c", style: BLOCK }, runs(["F"])),
        el("a", { href: "/d", style: BLOCK }, runs(["G"])),
      ]),
    ]),
    el("a", { href: "/e", style: BLOCK }, [
      el("ul", {}, [el("li", {}, runs(["H", "I", "J"]))]),
    ]),
    el("ul", {}, [el("li", {}, ["Ordinary item"])]),
  ]);
  assert.deepEqual(pairs(blocks), [["list-item", "Ordinary item"]]);
});

// --- link-only roots ---

const PROMO = "Promotional words that only advertise elsewhere. ".repeat(5);

for (const display of ["block", "contents"]) {
  test(`a main whose prose sits inside a ${display} anchor yields to the article`, () => {
    const doc = page([
      el("main", {}, [
        el("a", { href: "/promo", style: { display } }, [
          el("p", {}, [PROMO]),
        ]),
      ]),
      el("article", {}, [el("p", {}, [articleProse("Articleprose")])]),
    ]);
    const result = runExtract(doc);
    assert.deepEqual(pairs(result.blocks), [
      ["paragraph", articleProse("Articleprose").trim()],
    ]);
  });

  test(`a main with its own prose beside a ${display} anchor is still chosen`, () => {
    const doc = page([
      el("main", {}, [
        el("p", {}, [articleProse("Mainprose")]),
        el("a", { href: "/promo", style: { display } }, [
          el("p", {}, [PROMO]),
        ]),
      ]),
      el("article", {}, [el("p", {}, [articleProse("Articleprose")])]),
    ]);
    const result = runExtract(doc);
    assert.deepEqual(pairs(result.blocks), [
      ["paragraph", articleProse("Mainprose").trim()],
    ]);
  });
}

test("a scored candidate inside an anchor does not outrank real prose", () => {
  const doc = page([
    el("a", { href: "/promo", style: BLOCK }, [
      el("div", {}, [el("p", {}, [PROMO.repeat(2)])]),
    ]),
    el("div", {}, [el("p", {}, [articleProse("Divprose")])]),
  ]);
  const result = runExtract(doc);
  assert.deepEqual(pairs(result.blocks), [
    ["paragraph", articleProse("Divprose").trim()],
  ]);
});

// --- block boundaries inside a container's own text ---

function boundaryCases() {
  return [
    [
      el("ul", {}, [
        el("li", {}, [
          el("div", { style: BLOCK }, ["Alpha"]),
          el("div", { style: BLOCK }, ["Beta"]),
        ]),
      ]),
      [{ kind: "list-item", text: "Alpha\nBeta" }],
    ],
    [
      el("blockquote", {}, [
        "Alpha",
        el("div", { style: BLOCK }, ["Beta"]),
        "Gamma",
      ]),
      [{ kind: "quote", text: "Alpha\nBeta\nGamma" }],
    ],
    [
      el("table", {}, [
        el("tr", {}, [
          el("td", {}, [
            el("div", { style: BLOCK }, ["Head one"]),
            el("div", { style: BLOCK }, ["Head two"]),
          ]),
        ]),
      ]),
      [{ kind: "table-cell", row: 1, text: "Head one\nHead two" }],
    ],
    [
      el("ul", {}, [el("li", {}, ["前", el("span", { style: INLINE }, ["後"]), "。"])]),
      [{ kind: "list-item", text: "前後。" }],
    ],
    [
      el("ul", {}, [
        el("li", {}, ["Alpha", el("div", { style: INLINE }, ["Beta"]), "Gamma"]),
      ]),
      [{ kind: "list-item", text: "AlphaBetaGamma" }],
    ],
    [
      el("ul", {}, [
        el("li", {}, ["Alpha", el("div", { style: CONTENTS }, ["Beta"]), "Gamma"]),
      ]),
      [{ kind: "list-item", text: "AlphaBetaGamma" }],
    ],
    [
      el("ul", {}, [
        el("li", {}, [
          "Alpha",
          el("div", { hidden: true, style: BLOCK }, ["SECRET"]),
          "Beta",
        ]),
      ]),
      [{ kind: "list-item", text: "AlphaBeta" }],
    ],
    [
      el("ul", {}, [el("li", {}, ["Alpha", el("div", { style: BLOCK }, []), "Beta"])]),
      [{ kind: "list-item", text: "AlphaBeta" }],
    ],
    [
      el("ul", {}, [
        el("li", {}, ["Alpha ", el("div", { style: BLOCK }, ["Beta"]), " Gamma"]),
      ]),
      [{ kind: "list-item", text: "Alpha Beta Gamma" }],
    ],
    [
      el("ul", {}, [
        el("li", {}, [
          el("div", { style: BLOCK }, [
            "Before",
            el("ul", { style: BLOCK }, [el("li", {}, ["Child"])]),
            "After",
          ]),
        ]),
      ]),
      [
        { kind: "list-item", text: "Before" },
        { kind: "list-item", text: "Child" },
        { kind: "list-item", text: "After" },
      ],
    ],
    [
      el("blockquote", {}, [el("p", {}, ["Alpha"]), el("p", {}, ["Beta"])]),
      [{ kind: "quote", text: "Alpha\nBeta" }],
    ],
  ];
}

test("a container keeps a boundary at each displayed block wrapper, and none at inline ones", () => {
  for (const [fragment, expected] of boundaryCases()) {
    assert.deepEqual(extractInMain([fragment]), expected);
  }
  assert.equal(normalizeText("Alpha\nBeta"), "Alpha Beta");
});

function wrapperItem(style, tag = "div") {
  return el("ul", {}, [
    el("li", {}, ["Alpha", el(tag, { style }, ["Beta"]), "Gamma"]),
  ]);
}

test("the wrapper boundary follows the computed outer display, not the tag", () => {
  const boundary = [
    "block",
    "flow-root",
    "flex",
    "grid",
    "table",
    "list-item",
    "block flex",
    "block flow-root",
    "flow list-item",
  ];
  const noBoundary = [
    "inline",
    "inline-block",
    "inline-flex",
    "inline-grid",
    "inline-table",
    "contents",
    "inline flow-root",
    "inline list-item",
  ];
  for (const display of boundary) {
    assert.deepEqual(
      pairs(extractInMain([wrapperItem({ display })])),
      [["list-item", "Alpha\nBeta\nGamma"]],
      display,
    );
  }
  for (const display of noBoundary) {
    assert.deepEqual(
      pairs(extractInMain([wrapperItem({ display })])),
      [["list-item", "AlphaBetaGamma"]],
      display,
    );
  }
  assert.deepEqual(pairs(extractInMain([wrapperItem(BLOCK, "span")])), [
    ["list-item", "Alpha\nBeta\nGamma"],
  ]);
  assert.deepEqual(pairs(extractInMain([wrapperItem(INLINE, "div")])), [
    ["list-item", "AlphaBetaGamma"],
  ]);
  // Without a computed display, no wrapper boundary is inferred.
  assert.deepEqual(pairs(extractInMain([wrapperItem(undefined, "div")])), [
    ["list-item", "AlphaBetaGamma"],
  ]);
});

test("wrapper boundaries are not multiplied, invented or carried across a nested unit", () => {
  const item = (children) => el("ul", {}, [el("li", {}, children)]);
  const blocks = extractInMain([
    item([
      "Alpha",
      el("div", { style: BLOCK }, [el("div", { style: BLOCK }, ["Beta"])]),
      "Gamma",
    ]),
    item(["Alpha", el("div", { style: BLOCK }, [" "]), "Beta"]),
    item([
      "Alpha",
      el("div", { style: { display: "block", visibility: "hidden" } }, [
        "SECRET",
        el("span", { style: { display: "inline", visibility: "visible" } }, [
          "Beta",
        ]),
      ]),
      "Gamma",
    ]),
    item([
      "Alpha",
      el("div", { style: { display: "block", visibility: "hidden" } }, [
        "SECRET",
      ]),
      "Beta",
    ]),
    item([
      "Alpha",
      el("details", { style: BLOCK }, [
        el("summary", { style: BLOCK }, ["Shown"]),
        el("div", { style: BLOCK }, ["SECRET"]),
      ]),
      "Gamma",
    ]),
    item([
      "Alpha",
      el("div", { style: BLOCK }, ["Beta"]),
      el("ul", {}, [el("li", {}, ["Child"])]),
      "Gamma",
    ]),
    item([
      el("div", { style: BLOCK }, ["Alpha"]),
      el("br"),
      el("div", { style: BLOCK }, ["Beta"]),
    ]),
    item(["Intro", el("pre", {}, ["  code\n    line"]), "Outro"]),
  ]);
  assert.deepEqual(pairs(blocks), [
    ["list-item", "Alpha\nBeta\nGamma"],
    ["list-item", "Alpha Beta"],
    ["list-item", "Alpha\nBeta\nGamma"],
    ["list-item", "AlphaBeta"],
    ["list-item", "Alpha\nShown\nGamma"],
    ["list-item", "Alpha\nBeta"],
    ["list-item", "Child"],
    ["list-item", "Gamma"],
    ["list-item", "Alpha\nBeta"],
    ["list-item", "Intro"],
    ["code", "  code\n    line"],
    ["list-item", "Outro"],
  ]);
});

test("prose outside a container keeps its existing inline adjacency", () => {
  const blocks = extractInMain([
    el("p", {}, ["Alpha", el("span", { style: INLINE }, ["Beta"])]),
    el("div", { style: BLOCK }, [
      "Hello ",
      el("span", { style: INLINE }, ["world"]),
      "!",
    ]),
  ]);
  assert.deepEqual(pairs(blocks), [
    ["paragraph", "AlphaBeta"],
    ["paragraph", "Hello world!"],
  ]);
});

// --- line breaks and whitespace around link text ---

// Each case gets a block wrapper of its own, so its text is one prose
// buffer and is judged apart from its neighbours.
function prose(children) {
  return el("div", { style: BLOCK }, children);
}

function linkedBreaks(style) {
  return el("a", { href: "/x", style }, ["A", el("br"), "B", el("br"), "C"]);
}

test("a visible line break inside a link stays link text on every path", () => {
  const blocks = extractInMain([
    el("ul", {}, [
      el("li", {}, [linkedBreaks(INLINE)]),
      el("li", {}, [linkedBreaks(CONTENTS)]),
      el("li", {}, [linkedBreaks(BLOCK)]),
    ]),
    el("p", {}, [linkedBreaks(INLINE)]),
    prose([linkedBreaks(INLINE)]),
    prose([linkedBreaks(CONTENTS)]),
    prose([linkedBreaks(BLOCK)]),
    prose([el("span", { style: INLINE }, [linkedBreaks(INLINE)])]),
    prose([el("span", { style: CONTENTS }, [linkedBreaks(CONTENTS)])]),
    prose([
      el("span", { style: CONTENTS }, [
        el("span", { style: INLINE }, [linkedBreaks(INLINE)]),
      ]),
    ]),
    el("p", {}, ["Ordinary prose after it."]),
  ]);
  assert.deepEqual(pairs(blocks), [["paragraph", "Ordinary prose after it."]]);
});

function link(textValue) {
  return el("a", { href: "/x", style: INLINE }, [textValue]);
}

function spacedLinks() {
  return [link("A"), "    ", link("B")];
}

function brokenLinks() {
  return [link("A"), el("br"), link("B")];
}

function mixedSeparators() {
  return [
    link("A"),
    el("span", { style: INLINE }, ["  "]),
    " \n ",
    link("B"),
    el("div", { style: BLOCK }, [link("C")]),
  ];
}

test("text made only of links and separators is all link text", () => {
  const blocks = extractInMain([
    el("p", {}, spacedLinks()),
    el("p", {}, brokenLinks()),
    el("p", {}, mixedSeparators().slice(0, 4)),
    el("ul", {}, [
      el("li", {}, spacedLinks()),
      el("li", {}, brokenLinks()),
      el("li", {}, mixedSeparators()),
    ]),
    prose(spacedLinks()),
    prose(brokenLinks()),
    prose(mixedSeparators().slice(0, 4)),
    el("p", {}, ["Ordinary prose after it."]),
  ]);
  assert.deepEqual(pairs(blocks), [["paragraph", "Ordinary prose after it."]]);
});

test("mixed link text keeps its measured density, counting a link's own breaks", () => {
  const cases = () => [
    [el("a", { href: "/a", style: INLINE }, ["AB", el("br"), "CDEF"]), "XYZ"],
    [el("a", { href: "/b", style: INLINE }, ["AB", el("br"), "CDE"]), "WXYZ"],
    [el("a", { href: "/c", style: INLINE }, ["ABCDEF"]), el("br"), "XYZ"],
    [link("A"), "!"],
  ];
  const kept = ["AB\nCDEWXYZ", "ABCDEF\nXYZ", "A!"];
  const blocks = extractInMain([
    ...cases().map((children) => el("p", {}, children)),
    el("ul", {}, cases().map((children) => el("li", {}, children))),
    ...cases().map((children) => prose(children)),
  ]);
  assert.deepEqual(pairs(blocks), [
    ...kept.map((value) => ["paragraph", value]),
    ...kept.map((value) => ["list-item", value]),
    ...kept.map((value) => ["paragraph", value]),
  ]);
});

test("hidden text and hidden breaks take no part in link density", () => {
  const blocks = extractInMain([
    el("ul", {}, [
      el("li", {}, [
        el("a", { href: "/a" }, ["A", el("br"), "B"]),
        el("span", { hidden: true }, ["SECRET"]),
      ]),
      el("li", {}, ["Alpha", el("br", { hidden: true }), "Beta"]),
      el("li", {}, [
        el("a", { href: "/b" }, [
          "A",
          el("span", { hidden: true }, ["SECRETLINKSECRETLINK"]),
        ]),
        "Plain",
      ]),
      el("li", {}, [
        el("a", { href: "/c" }, ["A", el("br"), "B"]),
        el("span", { style: { visibility: "hidden" } }, [
          "SECRET",
          el("span", { style: { visibility: "visible" } }, ["Shown"]),
        ]),
      ]),
      el("li", {}, [
        el("a", { href: "/d" }, ["A", el("br"), "B"]),
        el("details", {}, [
          el("summary", {}, [el("a", { href: "/e" }, ["Summary"])]),
          el("div", {}, ["SECRET"]),
        ]),
      ]),
    ]),
  ]);
  assert.deepEqual(pairs(blocks), [
    ["list-item", "AlphaBeta"],
    ["list-item", "APlain"],
    ["list-item", "A\nBShown"],
  ]);
});

test("a container judges its link breaks over all its parts, not its nested unit", () => {
  const blocks = extractInMain([
    el("ul", {}, [
      el("li", {}, [
        el("a", { href: "/a" }, ["A", el("br"), "B"]),
        el("ul", {}, [el("li", {}, ["Child prose"])]),
        el("a", { href: "/b" }, ["C", el("br"), "D"]),
      ]),
      el("li", {}, [
        "A good deal of ordinary prose comes first.",
        el("ul", {}, [el("li", {}, [el("a", { href: "/c" }, ["E", el("br"), "F"])])]),
        el("a", { href: "/d" }, ["G", el("br"), "H"]),
      ]),
    ]),
    el("p", {}, ["Ordinary prose after it."]),
  ]);
  assert.deepEqual(pairs(blocks), [
    ["list-item", "Child prose"],
    ["list-item", "A good deal of ordinary prose comes first."],
    ["list-item", "G\nH"],
    ["paragraph", "Ordinary prose after it."],
  ]);
});

test("headings, quotes, code and cells of linked lines are not dropped for link density", () => {
  const lines = () => el("a", { href: "/x" }, ["A", el("br"), "B", el("br"), "C"]);
  const blocks = extractInMain([
    el("h2", {}, [lines()]),
    el("blockquote", {}, [lines()]),
    el("pre", {}, [lines()]),
    el("table", {}, [el("tr", {}, [el("td", {}, [lines()])])]),
  ]);
  assert.deepEqual(blocks, [
    { kind: "heading", level: 2, text: "A\nB\nC" },
    { kind: "quote", text: "A\nB\nC" },
    { kind: "code", text: "A\nB\nC" },
    { kind: "table-cell", row: 1, text: "A\nB\nC" },
  ]);

  const titled = runExtract(
    page([
      el("main", {}, [el("h1", {}, [lines()]), el("p", {}, [ROOT_PROSE])]),
    ]),
  );
  assert.equal(titled.title, "A\nB\nC");
  assert.deepEqual(pairs(titled.blocks), [["paragraph", ROOT_PROSE.trim()]]);
});

// --- roots made of links with breaks or spaces between them ---

function brokenLinkRun(display) {
  const children = [];
  for (let i = 0; i < 110; i++) {
    if (i > 0) children.push(el("br"));
    children.push("A");
  }
  return el("a", { href: "/run", style: { display } }, children);
}

function spacedLinkRun() {
  const children = [];
  for (let i = 0; i < 20; i++) {
    if (i > 0) children.push(" ".repeat(10));
    children.push(link("A"));
  }
  return children;
}

const ARTICLE_ONLY = [["paragraph", articleProse("Articleprose").trim()]];

for (const display of ["inline", "contents", "block"]) {
  test(`a main holding one ${display} link of broken lines yields to the article`, () => {
    const doc = page([
      el("main", {}, [brokenLinkRun(display)]),
      el("article", {}, [el("p", {}, [articleProse("Articleprose")])]),
    ]);
    assert.deepEqual(pairs(runExtract(doc).blocks), ARTICLE_ONLY);
  });
}

test("a main holding links separated only by spaces yields to the article", () => {
  const doc = page([
    el("main", {}, spacedLinkRun()),
    el("article", {}, [el("p", {}, [articleProse("Articleprose")])]),
  ]);
  assert.deepEqual(pairs(runExtract(doc).blocks), ARTICLE_ONLY);
});

test("a main with its own prose beside such links is still chosen", () => {
  const doc = page([
    el("main", {}, [
      el("p", {}, [articleProse("Mainprose")]),
      brokenLinkRun("inline"),
      ...spacedLinkRun(),
    ]),
    el("article", {}, [el("p", {}, [articleProse("Articleprose")])]),
  ]);
  assert.deepEqual(pairs(runExtract(doc).blocks), [
    ["paragraph", articleProse("Mainprose").trim()],
  ]);
});

test("a scored candidate of links and spaces scores nothing against real prose", () => {
  const doc = page([
    el("main", {}, [el("p", {}, ["Short main intro."])]),
    el("div", {}, [
      el("p", {}, [link("A"), " ".repeat(1000), link("B")]),
    ]),
    el("article", {}, [el("p", {}, [articleProse("Articleprose")])]),
  ]);
  assert.deepEqual(pairs(runExtract(doc).blocks), ARTICLE_ONLY);
});

// --- link density over the whole trimmed range, and inline wrappers ---

const LIST_ITEM = { display: "list-item" };

function visibleBreak() {
  return el("br", { style: { visibility: "visible" } });
}

// Each case is placed as a paragraph, as a list item and as a block-level
// prose buffer, and the kept cases come back once per path, in that order.
function threePathBlocks(cases) {
  return extractInMain([
    ...cases.map(([make]) => el("p", { style: BLOCK }, make())),
    el(
      "ul",
      { style: BLOCK },
      cases.map(([make]) => el("li", { style: LIST_ITEM }, make())),
    ),
    ...cases.map(([make]) => prose(make())),
  ]);
}

function threePathPairs(cases) {
  const kept = cases
    .filter(([, text]) => text !== null)
    .map(([, text]) => text);
  return [
    ...kept.map((text) => ["paragraph", text]),
    ...kept.map((text) => ["list-item", text]),
    ...kept.map((text) => ["paragraph", text]),
  ];
}

test("link density ignores whitespace trimmed from the whole block", () => {
  const cases = [
    [() => [link("  ABCDEF"), "WXYZ"], "ABCDEFWXYZ"],
    [() => ["WXYZ", link("ABCDEF  ")], "WXYZABCDEF"],
    [() => ["  ", link("ABCDEF"), "WXYZ", "  "], "ABCDEFWXYZ"],
    [() => [link("ABCDEF"), "WXYZ"], "ABCDEFWXYZ"],
    [() => [link("  ABCDEFG"), "XYZ"], null],
  ];
  assert.deepEqual(pairs(threePathBlocks(cases)), threePathPairs(cases));
});

test("link density counts only retained internal link whitespace", () => {
  const cases = [
    [() => ["XY", link(" ABCDEF "), "ZW"], "XY ABCDEF ZW"],
    [() => ["XY", link("  ABCDEF  "), "ZW"], null],
    [() => ["XY ", link("ABCDEF"), " ZW"], "XY ABCDEF ZW"],
    [() => [link("  ABCDEF"), visibleBreak(), "XYZ"], "ABCDEF\nXYZ"],
    [
      () => [
        el("a", { href: "/x", style: INLINE }, [
          "  AB",
          visibleBreak(),
          "CDEF",
        ]),
        "XYZ",
      ],
      null,
    ],
    [() => [link("  ABC"), "  ", link("DEF  ")], null],
  ];
  assert.deepEqual(pairs(threePathBlocks(cases)), threePathPairs(cases));
});

test("root scoring measures the same retained link character range", () => {
  const linked = Array.from({ length: 30 }, () =>
    el("p", { style: BLOCK }, ["XY", link("   ABCDEF   "), "ZW"]),
  );
  const doc = page([
    el("div", { style: BLOCK }, linked),
    el("div", { style: BLOCK }, [el("p", { style: BLOCK }, ["Z".repeat(240)])]),
  ]);
  assert.deepEqual(runExtract(doc), {
    title: "",
    blocks: [{ kind: "paragraph", text: "Z".repeat(240) }],
  });
});

test("container density trims the whole owned range across nested units", () => {
  const item = (first, last) =>
    el("ul", { style: BLOCK }, [
      el("li", { style: LIST_ITEM }, [
        link(first),
        el("ul", { style: BLOCK }, [el("li", { style: LIST_ITEM }, ["Child"])]),
        last,
      ]),
    ]);
  assert.deepEqual(pairs(extractInMain([item("  ABCDEF", "WXYZ  ")])), [
    ["list-item", "ABCDEF"],
    ["list-item", "Child"],
    ["list-item", "WXYZ"],
  ]);
  assert.deepEqual(pairs(extractInMain([item("  ABCDEFG", "XYZ  ")])), [
    ["list-item", "Child"],
  ]);
});

const FOUR_PARAGRAPHS = [
  ["paragraph", "Before"],
  ["paragraph", "Alpha"],
  ["paragraph", "Beta"],
  ["paragraph", "After"],
];

test("inline wrappers preserve nested block boundaries in prose", () => {
  for (const style of [INLINE, CONTENTS, BLOCK]) {
    const blocks = extractInMain([
      el("div", { style: BLOCK }, [
        "Before",
        el("div", { style }, [
          el("div", { style: BLOCK }, ["Alpha"]),
          el("div", { style: BLOCK }, ["Beta"]),
        ]),
        "After",
      ]),
    ]);
    assert.deepEqual(pairs(blocks), FOUR_PARAGRAPHS, style.display);
  }
});

test("paragraphs inside inline wrappers remain independent outside containers", () => {
  const wrapped = (style) => [
    "Before",
    el("div", { style }, [
      el("p", { style: BLOCK }, ["Alpha"]),
      el("p", { style: BLOCK }, ["Beta"]),
    ]),
    "After",
  ];
  for (const style of [INLINE, CONTENTS]) {
    const blocks = extractInMain([el("div", { style: BLOCK }, wrapped(style))]);
    assert.deepEqual(pairs(blocks), FOUR_PARAGRAPHS, style.display);
  }
  const quoted = extractInMain([
    el("blockquote", { style: BLOCK }, wrapped(INLINE)),
  ]);
  assert.deepEqual(pairs(quoted), [["quote", "Before\nAlpha\nBeta\nAfter"]]);
});

test("a linked paragraph inside an inline wrapper is not merged into prose", () => {
  for (const style of [INLINE, CONTENTS, BLOCK]) {
    const blocks = extractInMain([
      el("div", { style: BLOCK }, [
        "This is real prose with enough text. ",
        el("a", { href: "/promotion", style }, [
          el("p", { style: BLOCK }, ["Promotion"]),
        ]),
        " More real prose.",
      ]),
    ]);
    assert.deepEqual(
      pairs(blocks),
      [
        ["paragraph", "This is real prose with enough text."],
        ["paragraph", "More real prose."],
      ],
      style.display,
    );
  }
  const ordinary = extractInMain([
    el("div", { style: BLOCK }, ["Hello ", link("world"), "!"]),
  ]);
  assert.deepEqual(pairs(ordinary), [["paragraph", "Hello world!"]]);
});

test("inline traversal keeps visibility exclusions and independent units", () => {
  const units = extractInMain([
    el("div", { style: BLOCK }, [
      "Before ",
      el("div", { style: INLINE }, [
        el("div", { hidden: true, style: BLOCK }, ["SECRET"]),
        el("span", { style: INLINE }, ["word"]),
        el("h2", { style: BLOCK }, ["Heading"]),
        el("p", { style: BLOCK }, ["Paragraph"]),
        el("span", { style: INLINE }, ["tail"]),
      ]),
      " After",
    ]),
  ]);
  assert.deepEqual(units, [
    { kind: "paragraph", text: "Before word" },
    { kind: "heading", level: 2, text: "Heading" },
    { kind: "paragraph", text: "Paragraph" },
    { kind: "paragraph", text: "tail After" },
  ]);

  const overrides = extractInMain([
    el("div", { style: BLOCK }, [
      el("div", { style: { display: "inline", visibility: "hidden" } }, [
        "SECRET",
        el("span", { style: { display: "inline", visibility: "visible" } }, [
          "Shown",
        ]),
        el("div", { style: { display: "block", visibility: "visible" } }, [
          "Block",
        ]),
      ]),
    ]),
  ]);
  assert.deepEqual(pairs(overrides), [
    ["paragraph", "Shown"],
    ["paragraph", "Block"],
  ]);
});
