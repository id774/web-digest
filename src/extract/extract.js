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
  const CANDIDATE_TAGS = new Set(CANDIDATE.split(",").map((s) => s.trim()));
  // Every candidate but `p`: an element whose content is its own
  // reading-order unit, never absorbed into an ancestor container's text.
  const INDEPENDENT_UNIT_TAGS = new Set(
    [...CANDIDATE_TAGS].filter((tag) => tag !== "p"),
  );
  // Outer semantic containers whose kind and direct text must survive an
  // ordinary prose wrapper (typically a `p`) placed inside them.
  const CONTAINER_TAGS = new Set(["li", "blockquote", "th", "td"]);
  // A block of one of these kinds is never dropped for being link-dense: a
  // heading, a quote, a code block or a table cell can legitimately be
  // nothing but a link and still be the content the reader asked for.
  const LINK_DENSITY_EXEMPT_KINDS = new Set([
    "heading",
    "quote",
    "code",
    "table-cell",
  ]);

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

  // Furniture, non-content, or not displayed: the same three reasons a
  // candidate is dropped from block collection, now also the reason a
  // subtree is skipped when measuring how much content a root candidate — or
  // a semantic container's own text — actually holds.
  function isExcluded(element) {
    return (
      isHidden(element) ||
      !!element.closest(FURNITURE) ||
      !!element.closest(NON_CONTENT)
    );
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

  // The text inside `element` that a reader would actually see: hidden,
  // furniture and non-content subtrees contribute nothing, so root selection
  // can never mistake a root with a lot of hidden text for one with a lot of
  // content — the same content block collection below would go on to keep.
  // `element` itself is checked too, not just its descendants: a candidate
  // that is itself excluded — hidden outright, or holding direct text with
  // no element of its own to carry the check — must measure as empty, the
  // same as if none of its content existed.
  function eligibleText(element) {
    if (isExcluded(element)) return "";
    let text = "";
    for (const child of element.childNodes) {
      if (child.nodeType === 3) {
        text += child.textContent;
      } else if (child.nodeType === 1) {
        text += eligibleText(child);
      }
    }
    return text.trim();
  }

  // The same eligible/excluded distinction, applied to the anchors inside
  // `element`, so a hidden or furniture link cannot move a candidate's score.
  function eligibleLinkDensity(element, text) {
    if (text.length === 0) return 0;
    let linkChars = 0;
    for (const anchor of element.querySelectorAll("a")) {
      linkChars += eligibleText(anchor).length;
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
    if (declared && eligibleText(declared).length >= MIN_ROOT_CHARS) {
      return declared;
    }

    let best = null;
    let bestScore = 0;
    let bestText = "";
    const scope = doc.body || doc;
    for (const element of scope.querySelectorAll("article, section, div")) {
      if (!element.querySelector("p")) continue;
      const text = eligibleText(element);
      if (text.length === 0) continue;
      const density = eligibleLinkDensity(element, text);
      const score = text.length * (1 - density);
      if (score > bestScore) {
        bestScore = score;
        best = element;
        bestText = text;
      }
    }
    if (best && bestText.length >= MIN_ROOT_CHARS) return best;

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

  function kindForTag(tag) {
    if (tag.length === 2 && tag[0] === "h" && tag[1] >= "1" && tag[1] <= "6") {
      return "heading";
    }
    if (tag === "p") return "paragraph";
    if (tag === "li") return "list-item";
    if (tag === "blockquote") return "quote";
    if (tag === "pre") return "code";
    return "table-cell"; // th, td
  }

  function blockFor(element, tag, text, rows) {
    const kind = kindForTag(tag);
    if (kind === "heading") return { kind, level: Number(tag[1]), text };
    if (kind === "table-cell") {
      const row = element.closest ? element.closest("tr") : null;
      return { kind, row: rows.get(row) || 0, text };
    }
    return { kind, text };
  }

  // The text a semantic container (li, blockquote, th, td) owns directly: an
  // ordinary prose wrapper inside it — a `p`, or any element that is not
  // itself a candidate — contributes its text here, exactly once. A nested
  // element that is its own independent unit (another list item, a nested
  // quote, a heading, a code block or another table cell) contributes
  // nothing here; it is collected separately, as its own block, keeping the
  // outer container's kind and direct text intact rather than losing them to
  // the descendant's presence.
  function ownedContent(element) {
    let text = "";
    let linkChars = 0;

    function walk(node, insideAnchor) {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) {
          const segment = child.textContent.trim();
          if (segment.length === 0) continue;
          text += (text.length > 0 ? " " : "") + segment;
          if (insideAnchor) linkChars += segment.length;
          continue;
        }
        if (child.nodeType !== 1) continue;
        if (isExcluded(child)) continue;
        const tag = child.tagName.toLowerCase();
        if (INDEPENDENT_UNIT_TAGS.has(tag)) continue;
        walk(child, insideAnchor || tag === "a");
      }
    }

    walk(element, false);
    return { text, linkChars };
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

  function tryEmit(element, tag, text, density) {
    if (text.length === 0) return;
    const kind = kindForTag(tag);
    if (!LINK_DENSITY_EXEMPT_KINDS.has(kind) && density >= LINK_DENSITY_MAX) {
      return;
    }
    blocks.push(blockFor(element, tag, text, rows));
  }

  function tryEmitLeaf(element, tag) {
    if (element === titleElement) return;
    const text =
      tag === "pre"
        ? (element.textContent || "").replace(/^\n+|\s+$/g, "")
        : textOf(element);
    const density = tag === "pre" ? 0 : linkDensity(element);
    tryEmit(element, tag, text, density);
  }

  function tryEmitContainer(element, tag) {
    const owned = ownedContent(element);
    const density = owned.text.length === 0 ? 0 : owned.linkChars / owned.text.length;
    tryEmit(element, tag, owned.text, density);
  }

  // The accepted root, walked top-down in document order. `absorbingP` is
  // true once inside a semantic container whose own block already owns every
  // ordinary `p` beneath it — so those `p`s are searched for nested
  // independent units, never re-emitted as paragraphs of their own.
  function collectBlocks(node, absorbingP) {
    for (const child of node.children) {
      if (isExcluded(child)) continue;
      const tag = child.tagName.toLowerCase();

      if (tag === "p") {
        if (absorbingP) {
          collectBlocks(child, true);
        } else {
          tryEmitLeaf(child, tag);
        }
        continue;
      }
      if (CONTAINER_TAGS.has(tag)) {
        tryEmitContainer(child, tag);
        collectBlocks(child, true);
        continue;
      }
      if (CANDIDATE_TAGS.has(tag)) {
        tryEmitLeaf(child, tag);
        continue;
      }
      collectBlocks(child, absorbingP);
    }
  }

  collectBlocks(root, false);

  return { title, blocks };
}

webDigestExtract(document);
