// The injected extraction pass.
//
// Not a declared content script: it is injected into the tab the reader acted
// on, at the moment they acted, and it runs once. It reads the document and
// returns an ordered list of blocks. It adds no node, sets no attribute,
// registers no listener, calls no function of the page, makes no request, and
// holds no setting and no token. The page is read, never written.
//
// Injected as a file, so ES module imports are not available to it: it is
// self-contained by necessity as well as by design. It declares one function,
// calls it, and the value of that call is what chrome.scripting returns.
//
// No URL is returned. Nothing in this design displays one or stores one, and
// the smallest way to keep "no browsing history" true is to never carry it.

function webDigestExtract(doc) {
  // When a rung of the ladder has found enough text to stop at.
  const MIN_ROOT_CHARS = 200;
  // When a block is a list of links rather than prose.
  const LINK_DENSITY_MAX = 0.7;

  const CANDIDATE = "h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, th, td";
  const FURNITURE =
    'nav, header, footer, aside, form, dialog, [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"], [role="search"], [role="form"]';
  const NON_CONTENT =
    "script, style, noscript, template, iframe, svg, canvas, button, select, textarea, input, label";

  const view = doc.defaultView;

  function textOf(element) {
    return (element.textContent || "").trim();
  }

  function isHidden(element) {
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
      if (node.hidden === true) return true;
      if (node.getAttribute && node.getAttribute("aria-hidden") === "true") {
        return true;
      }
      if (view && typeof view.getComputedStyle === "function") {
        const style = view.getComputedStyle(node);
        if (style && (style.display === "none" || style.visibility === "hidden")) {
          return true;
        }
      }
    }
    return false;
  }

  // Prose is worth its length, and a block that is mostly link text is worth
  // almost nothing — which is what navigation, related-article rails and
  // advertising look like from inside a document.
  function linkDensity(element) {
    const text = textOf(element);
    if (text.length === 0) return 0;
    let linkChars = 0;
    const anchors = element.querySelectorAll("a");
    for (const anchor of anchors) {
      linkChars += (anchor.textContent || "").trim().length;
    }
    return linkChars / text.length;
  }

  // The ladder: each rung is more permissive and less accurate than the one
  // above it. A page that reaches the third produces a noisier summary; one
  // that yields too little text even there is judged by shaping.
  function chooseRoot() {
    const declared =
      doc.querySelector("main") ||
      doc.querySelector('[role="main"]') ||
      doc.querySelector("article");
    if (declared && textOf(declared).length >= MIN_ROOT_CHARS) return declared;

    let best = null;
    let bestScore = 0;
    const scope = doc.body || doc;
    for (const element of scope.querySelectorAll("article, section, div")) {
      if (!element.querySelector("p")) continue;
      const text = textOf(element);
      if (text.length === 0) continue;
      const score = text.length * (1 - linkDensity(element));
      if (score > bestScore) {
        bestScore = score;
        best = element;
      }
    }
    if (best && textOf(best).length >= MIN_ROOT_CHARS) return best;

    return doc.body || doc.documentElement;
  }

  function rowNumbers() {
    const numbers = new Map();
    let n = 0;
    // Counted over the document, so cells of different tables never share a
    // row number.
    for (const row of doc.querySelectorAll("tr")) {
      n += 1;
      numbers.set(row, n);
    }
    return numbers;
  }

  function blockFor(element, text, rows) {
    const tag = element.tagName.toLowerCase();
    if (tag.length === 2 && tag[0] === "h" && tag[1] >= "1" && tag[1] <= "6") {
      return { kind: "heading", level: Number(tag[1]), text };
    }
    if (tag === "p") return { kind: "paragraph", text };
    if (tag === "li") return { kind: "list-item", text };
    if (tag === "blockquote") return { kind: "quote", text };
    if (tag === "pre") return { kind: "code", text };
    const row = element.closest ? element.closest("tr") : null;
    return { kind: "table-cell", row: rows.get(row) || 0, text };
  }

  const root = chooseRoot();

  // The page's own heading, where document.title usually carries the site name
  // as well. An h1 used as the title is not also emitted as a heading block.
  let title = "";
  let titleElement = null;
  const heading = root.querySelector ? root.querySelector("h1") : null;
  if (heading && textOf(heading).length > 0) {
    title = textOf(heading);
    titleElement = heading;
  } else if (typeof doc.title === "string" && doc.title.trim().length > 0) {
    title = doc.title.trim();
  }

  const rows = rowNumbers();
  const blocks = [];

  for (const element of root.querySelectorAll(CANDIDATE)) {
    if (element === titleElement) continue;
    // Emitted only when it contains no candidate of its own, so that a li
    // holding a p yields one block and not two.
    if (element.querySelector(CANDIDATE)) continue;
    if (element.closest(FURNITURE)) continue;
    if (element.closest(NON_CONTENT)) continue;
    if (isHidden(element)) continue;

    const text =
      element.tagName.toLowerCase() === "pre"
        ? (element.textContent || "").replace(/^\n+|\s+$/g, "")
        : textOf(element);
    if (text.length === 0) continue;
    if (linkDensity(element) >= LINK_DENSITY_MAX) continue;

    blocks.push(blockFor(element, text, rows));
  }

  return { title, blocks };
}

webDigestExtract(document);
