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
