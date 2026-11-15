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
  // Computed `display` values whose outer display is block. A single keyword
  // is read as CSS defines it. A multi-keyword value is block-level when each
  // of its keywords is in the second set, so one naming `inline` is not.
  const BLOCK_LEVEL_DISPLAYS = new Set([
    "block",
    "flow-root",
    "flex",
    "grid",
    "table",
    "list-item",
  ]);
  const BLOCK_LEVEL_KEYWORDS = new Set([
    "block",
    "flow",
    "flow-root",
    "flex",
    "grid",
    "table",
    "list-item",
  ]);

  // `header` is deliberately not in this list: HTML gives a `header` the
  // implicit "banner" landmark role only when it has no `article`, `aside`,
  // `main`, `nav` or `section` ancestor — the site-common page banner, not a
  // content-local one. `bannerHeaderAncestor` below excludes exactly that
  // landmark case, so an `article`- or `section`-local `header` (a title and
  // introduction, say) is not thrown out just for sharing the tag name.
  const FURNITURE =
    'nav, footer, aside, form, dialog, [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"], [role="search"], [role="form"]';
  const NON_CONTENT =
    "script, style, noscript, template, iframe, svg, canvas, button, select, textarea, input, label";
  const BANNER_SUPPRESSING_ANCESTORS = new Set([
    "article",
    "aside",
    "main",
    "nav",
    "section",
  ]);

  const view = doc.defaultView;

  // True for a `header` with no `article`/`aside`/`main`/`nav`/`section`
  // ancestor: HTML's own implicit-"banner" case, and the only `header` this
  // extraction treats as site-common furniture.
  function isBannerHeader(element) {
    if (!element.tagName || element.tagName.toLowerCase() !== "header") {
      return false;
    }
    for (let node = element.parentElement; node; node = node.parentElement) {
      const tag = node.tagName && node.tagName.toLowerCase();
      if (tag && BANNER_SUPPRESSING_ANCESTORS.has(tag)) return false;
    }
    return true;
  }

  // The same ancestor walk `element.closest(FURNITURE)` performs for the
  // ordinary furniture list, but for the one furniture case — the page-banner
  // `header` — that a plain tag-name selector cannot express.
  function bannerHeaderAncestor(element) {
    for (let node = element; node; node = node.parentElement) {
      if (isBannerHeader(node)) return node;
    }
    return null;
  }

  // A `details` without an `open` attribute renders only its first `summary`
  // child. The rest of its content sits in an internal slot whose hiding
  // never shows up in any ancestor's computed style. The attribute's mere
  // presence means open — `open="false"` included — so `getAttribute` is
  // read, not a value.
  function isClosedDetails(element) {
    return (
      !!element.tagName &&
      element.tagName.toLowerCase() === "details" &&
      element.getAttribute("open") === null
    );
  }

  function firstSummaryChild(details) {
    for (const child of details.children) {
      if (child.tagName && child.tagName.toLowerCase() === "summary") {
        return child;
      }
    }
    return null;
  }

  // Every reason a subtree is skipped *whole* — nothing inside it is ever
  // examined once one of these holds, because nothing inside can undo it.
  // `hidden`, `aria-hidden`, a computed `display: none` and a computed
  // `content-visibility: hidden` are structural this way. So is being
  // furniture, non-content, or a page-banner header, since no CSS a
  // descendant carries lets it stop being any of those. So is being inside a
  // closed `details` anywhere but its first `summary` child, whatever the
  // descendant's own styling says.
  function isStructurallyExcluded(element) {
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
      if (node.hidden === true) return true;
      const parent = node.parentElement;
      if (
        parent &&
        isClosedDetails(parent) &&
        node !== firstSummaryChild(parent)
      ) {
        return true;
      }
      if (
        node.getAttribute &&
        node.getAttribute("aria-hidden")?.toLowerCase() === "true"
      ) {
        return true;
      }
      if (view && typeof view.getComputedStyle === "function") {
        const style = view.getComputedStyle(node);
        if (style && style.display === "none") return true;
        // `content-visibility: hidden` skips rendering of everything the
        // element contains, whatever a descendant's own `visibility` says.
        if (style && style.contentVisibility === "hidden") return true;
      }
    }
    return (
      !!element.closest(FURNITURE) ||
      !!element.closest(NON_CONTENT) ||
      !!bannerHeaderAncestor(element)
    );
  }

  // Unlike the structural reasons above, `visibility` inherits, but a
  // descendant can set its own `visibility: visible` to override an
  // ancestor's `hidden`/`collapse`. The browser's own computed style for
  // `element` already resolves that cascade, so only `element`'s own
  // value is read here, on `element` alone — never walked up the ancestor
  // chain, and never used to stop a caller from continuing to look at
  // `element`'s own children, since one of them may be the override.
  function isVisibilityHidden(element) {
    if (!view || typeof view.getComputedStyle !== "function") return false;
    const style = view.getComputedStyle(element);
    return !!style && (style.visibility === "hidden" || style.visibility === "collapse");
  }

  // Whether `element`'s own direct text nodes are hidden. They carry no style
  // of their own, so they borrow the element's: its effective `visibility`,
  // or being a closed `details`, whose direct text is never rendered.
  function isOwnTextHidden(element) {
    return isVisibilityHidden(element) || isClosedDetails(element);
  }

  // Whether `element`'s own content should be counted at all: structurally
  // excluded, or hidden by its own effective visibility. Recursion into an
  // element's children never uses this — only `isStructurallyExcluded` —
  // because a visibility-hidden element's own content is excluded without
  // that stopping a nested override from being found underneath it.
  function isExcluded(element) {
    return isStructurallyExcluded(element) || isVisibilityHidden(element);
  }

  // The text inside `element` that a reader would actually see: hidden,
  // furniture and non-content subtrees contribute nothing, so root selection
  // can never mistake a root with a lot of hidden text for one with a lot of
  // content — the same content block collection below would go on to keep.
  // `element` itself is checked too, not just its descendants: a candidate
  // that is itself excluded — hidden outright, or holding direct text with
  // no element of its own to carry the check — must measure as empty, the
  // same as if none of its content existed.
  //
  // The recursive walk (`eligibleSegments`) never trims: an inner call's
  // segments are fragments being concatenated into their parent's text, not
  // a standalone value, so trimming them there would drop authored whitespace
  // sitting at exactly a descendant's own boundary — `Hello<strong>
  // world</strong>` losing `strong`'s own leading space, the same defect
  // `ownedContent` was fixed for. Only `measureSegments` trims — once, at the
  // two edges of the whole result.
  function eligibleText(element) {
    return measureSegments(eligibleSegments(element)).text;
  }

  // The eligible text of `element` as ordered segments, each marked with
  // whether it is link text. `linked` starts from `element`'s own anchor
  // context, so a link that wraps it makes every segment link text.
  //
  // Recursion into a child element happens unconditionally here — never
  // gated by `element`'s own visibility — because the child gets its own
  // independent `isStructurallyExcluded`/`isVisibilityHidden` check the
  // moment this function is called on it. Only `element`'s own direct text
  // nodes, which carry no style of their own, borrow `element`'s effective
  // visibility to decide whether they count.
  function eligibleSegments(
    element,
    linked = isInsideAnchor(element),
    segments = [],
  ) {
    if (isStructurallyExcluded(element)) return segments;
    const ownContentHidden = isOwnTextHidden(element);
    for (const child of element.childNodes) {
      if (child.nodeType === 3) {
        if (!ownContentHidden) {
          segments.push({ text: child.textContent, linked });
        }
      } else if (child.nodeType === 1) {
        // A visible line break is a text boundary an author actually wrote:
        // `foo<br>bar` must not read as `foobar` once these two runs are
        // concatenated. The break's own computed visibility decides, so a
        // visible `<br>` stays even under a visibility-hidden parent. Later
        // shaping is free to fold this into a space with every other line
        // break. Only the boundary must survive here.
        const tag = child.tagName.toLowerCase();
        if (tag === "br") {
          if (!isExcluded(child)) segments.push({ text: "\n", linked });
          continue;
        }
        eligibleSegments(child, linked || tag === "a", segments);
      }
    }
    return segments;
  }

  // True when `element` is an anchor or sits inside one. All of its text is
  // then link text, however the anchor renders.
  function isInsideAnchor(element) {
    return !!element.closest && !!element.closest("a");
  }

  // The text and link density of ordered segments, both measured over the
  // same range: the joined text with its two outer edges trimmed. A link's
  // own edges are not trimmed separately, so whitespace at the edge of the
  // whole text cannot move the density either way. Whitespace inside the
  // range counts by its own link context. With no non-whitespace text
  // outside a link, the density is one: spaces or line breaks between links
  // do not turn a list of links into prose.
  function measureSegments(segments) {
    const raw = segments.map((segment) => segment.text).join("");
    const text = raw.trim();
    if (text.length === 0) return { text, density: 0 };
    const start = raw.length - raw.trimStart().length;
    const end = start + text.length;
    let offset = 0;
    let linkChars = 0;
    let plain = false;
    for (const segment of segments) {
      const next = offset + segment.text.length;
      const from = Math.max(start, offset);
      const to = Math.min(end, next);
      if (from < to) {
        if (segment.linked) {
          linkChars += to - from;
        } else if (/\S/.test(segment.text.slice(from - offset, to - offset))) {
          plain = true;
        }
      }
      offset = next;
    }
    return { text, density: plain ? linkChars / text.length : 1 };
  }

  // The ladder: each rung is more permissive and less accurate than the one
  // above it. A page that reaches the third produces a noisier summary. One
  // that yields too little text even there is judged by shaping.
  function chooseRoot() {
    const declared =
      doc.querySelector("main") ||
      doc.querySelector('[role="main"]') ||
      doc.querySelector("article");
    if (declared && retainedCharsForRoot(declared) >= MIN_ROOT_CHARS) {
      return declared;
    }

    let best = null;
    let bestScore = 0;
    const scope = doc.body || doc;
    for (const element of scope.querySelectorAll("article, section, div")) {
      if (!element.querySelector("p")) continue;
      const { text, density } = measureSegments(eligibleSegments(element));
      if (text.length === 0) continue;
      const score = text.length * (1 - density);
      if (score > bestScore) {
        bestScore = score;
        best = element;
      }
    }
    if (best && retainedCharsForRoot(best) >= MIN_ROOT_CHARS) return best;

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
  // nothing here. It is collected separately, as its own block, keeping the
  // outer container's kind and direct text intact rather than losing them to
  // the descendant's presence.
  //
  // Text nodes are concatenated in DOM order with no separator inserted
  // between them: an inline element boundary is not by itself a reason for a
  // space to appear, so `前<strong>後</strong>。` stays `前後。` and
  // `<a>docs</a>.` stays `docs.` rather than gaining artificial spaces. Any
  // whitespace an author actually wrote is preserved here and left to later
  // shaping to normalize. Only the two edges of the whole returned text are
  // trimmed.
  //
  // `insideAnchor` seeds whether `element` itself is already inside an
  // anchor's link text: `collectContainer` calls this on a container that
  // may sit inside one. The internal walk would otherwise miss that context,
  // since it only turns the flag on for a descendant tagged `a`, never for
  // the element it starts from or its ancestors.
  //
  // The block boundary inserted here is that of a `p` or of any other
  // wrapper whose computed display is block-level: when one begins or ends
  // beside other text, one line break stands between them, so
  // `<p>Alpha</p><p>Beta</p>` and `<div>Alpha</div><div>Beta</div>` are never
  // `AlphaBeta`. It is added only between two runs that both carry text and
  // only where the author wrote no whitespace of their own. Nested wrappers
  // share one boundary. An empty or hidden wrapper adds nothing, and an
  // inline boundary never does. Every segment keeps its link context: a
  // break placed between two runs of link text is link text, and so is a
  // visible `<br>` inside a link, so a boundary cannot make a list of links
  // look like prose.
  //
  // `onUnit`, when given, is called for each independent unit met on the
  // way, in document order, with the text and segments gathered so far.
  // Gathering then restarts. That is what lets a container's text be
  // emitted in pieces around a nested unit instead of all before it.
  //
  // The returned `text` is untrimmed: the container emitting it as its own
  // standalone blocks trims each part once, at that point
  // (`collectContainer`), and measures the untrimmed parts together.
  function ownedContent(element, insideAnchor = false, onUnit = null) {
    let text = "";
    let segments = [];
    let pendingBreak = false;
    // Whether the last appended segment was link text.
    let lastWasLink = false;
    // Counts what has been appended, so a paragraph that added nothing can be
    // told from one that did.
    let appended = 0;

    function append(segment, isLink) {
      appended += 1;
      if (
        pendingBreak &&
        text.length > 0 &&
        !/\s$/.test(text) &&
        !/^\s/.test(segment)
      ) {
        text += "\n";
        segments.push({ text: "\n", linked: lastWasLink && isLink });
      }
      pendingBreak = false;
      lastWasLink = isLink;
      text += segment;
      segments.push({ text: segment, linked: isLink });
    }

    // `hiddenBySelf` is `node`'s own effective visibility: it gates only
    // `node`'s direct text-node children, which carry no style of their
    // own. Recursion into a child element is never gated by it — the
    // child's own visibility is checked independently below, so a
    // descendant that overrides `node`'s `visibility: hidden` back to
    // visible is still found and kept.
    function walk(node, insideAnchor, hiddenBySelf) {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) {
          if (hiddenBySelf) continue;
          const segment = child.textContent;
          if (segment.length === 0) continue;
          append(segment, insideAnchor);
          continue;
        }
        if (child.nodeType !== 1) continue;
        if (isStructurallyExcluded(child)) continue;
        const tag = child.tagName.toLowerCase();
        const childHidden = isOwnTextHidden(child);
        // Same visible-boundary rule as eligibleText: a `<br>` must not let
        // two authored text runs merge into one word.
        if (tag === "br") {
          if (!isVisibilityHidden(child)) {
            append("\n", insideAnchor);
          }
          continue;
        }
        if (INDEPENDENT_UNIT_TAGS.has(tag)) {
          if (onUnit) {
            onUnit(child, tag, { text, segments });
            text = "";
            segments = [];
            pendingBreak = false;
            lastWasLink = false;
          }
          continue;
        }
        if (tag === "p" || isBlockLevelDisplay(child)) {
          // A wrapper that contributes no text leaves the boundary state
          // exactly as it found it.
          const breakBefore = pendingBreak;
          const appendedBefore = appended;
          pendingBreak = true;
          walk(child, insideAnchor || tag === "a", childHidden);
          pendingBreak = appended === appendedBefore ? breakBefore : true;
          continue;
        }
        walk(child, insideAnchor || tag === "a", childHidden);
      }
    }

    walk(element, insideAnchor, isOwnTextHidden(element));
    return { text, segments };
  }

  // True when `element` renders inline, by its own computed style: the
  // ordinary case for `strong`, `em`, `span`, `a`, and the rest of the
  // elements HTML mixes into a line of prose rather than stacks as blocks.
  // This is a rendering fact the page already carries, not a tag this design
  // enumerates: nothing here is special-cased by name, and no table of
  // "known inline tags" is maintained.
  function isInlineDisplay(element) {
    if (!view || typeof view.getComputedStyle !== "function") return false;
    const style = view.getComputedStyle(element);
    return (
      !!style &&
      typeof style.display === "string" &&
      style.display.startsWith("inline")
    );
  }

  // True when `element` generates a block-level box by its own computed
  // style, the outer display CSS gives it. Inline-level boxes and
  // `display: contents` are not block-level. Without a computed display,
  // nothing is assumed.
  function isBlockLevelDisplay(element) {
    if (!view || typeof view.getComputedStyle !== "function") return false;
    const style = view.getComputedStyle(element);
    if (!style || typeof style.display !== "string") return false;
    const keywords = style.display.trim().toLowerCase().split(/\s+/);
    if (keywords.length === 1) return BLOCK_LEVEL_DISPLAYS.has(keywords[0]);
    return keywords.every((keyword) => BLOCK_LEVEL_KEYWORDS.has(keyword));
  }

  // True when `element` generates no box of its own: its children render as
  // if they sat directly in its parent, so the wrapper itself is not a
  // paragraph boundary either — collectBlocks below processes its children
  // in the same buffer as if the wrapper were not there at all, rather than
  // flushing before it and starting a new one.
  function isContentsDisplay(element) {
    if (!view || typeof view.getComputedStyle !== "function") return false;
    const style = view.getComputedStyle(element);
    return !!style && style.display === "contents";
  }

  // State shared by the provisional and the final collection. It is set up
  // before the root is chosen, because choosing a root collects blocks.
  const rows = rowNumbers();
  const blocks = [];
  let titleElement = null;

  // The page's own heading, where document.title usually carries the site name
  // as well. An h1 used as the title is not also emitted as a heading block.
  // The same eligibility rule that decides block collection decides this: an
  // h1 that is itself excluded, or that holds no eligible text of its own, is
  // never the title just for being the first one in the document — the
  // search keeps going to the next h1, and falls back to document.title if
  // none qualifies.
  function findTitleElement(candidate) {
    const headingCandidates = candidate.querySelectorAll
      ? candidate.querySelectorAll("h1")
      : [];
    for (const heading of headingCandidates) {
      if (isExcluded(heading)) continue;
      if (eligibleText(heading).length === 0) continue;
      return heading;
    }
    return null;
  }

  // How much text collecting `candidate` would actually keep: the same
  // collection as the final one, run provisionally, with the title h1
  // reserved. Nothing it gathers is left behind.
  function retainedCharsForRoot(candidate) {
    blocks.length = 0;
    titleElement = findTitleElement(candidate);
    collectFromRoot(candidate);
    const total = blocks.reduce((sum, block) => sum + block.text.length, 0);
    blocks.length = 0;
    titleElement = null;
    return total;
  }

  // A candidate root is checked itself, not only its children: its own
  // direct text has no child element to carry the check, so a root that is
  // structurally excluded contributes nothing.
  // A root inside an anchor starts in that anchor's link context.
  function collectFromRoot(candidate) {
    if (isStructurallyExcluded(candidate)) return;
    collectBlocks(candidate, isInsideAnchor(candidate));
  }

  const root = chooseRoot();

  let title = "";
  titleElement = findTitleElement(root);
  if (titleElement) {
    title = eligibleText(titleElement);
  } else if (typeof doc.title === "string" && doc.title.trim().length > 0) {
    title = doc.title.trim();
  }

  function tryEmit(element, tag, text, density) {
    if (text.length === 0) return;
    const kind = kindForTag(tag);
    if (!LINK_DENSITY_EXEMPT_KINDS.has(kind) && density >= LINK_DENSITY_MAX) {
      return;
    }
    blocks.push(blockFor(element, tag, text, rows));
  }

  // `pre`'s own verbatim collection: every text node's content is kept
  // exactly, including line breaks and indentation, but a descendant element
  // is still subject to the same exclusion `isExcluded` applies everywhere
  // else, so a hidden, aria-hidden, furniture or non-content descendant
  // cannot leak into a code block the way raw `element.textContent` would
  // let it. Internal whitespace is never normalized here. Only the
  // block-edge trim below still applies to the result. A visible `<br>` is
  // the same authored line-break boundary it is in ordinary prose — code
  // keeps line breaks as meaningful content, so `<pre>foo<br>bar</pre>` is
  // `foo\nbar`, never `foobar`.
  function codeText(element) {
    if (isStructurallyExcluded(element)) return "";
    const ownContentHidden = isOwnTextHidden(element);
    let text = "";
    for (const child of element.childNodes) {
      if (child.nodeType === 3) {
        if (!ownContentHidden) text += child.textContent;
      } else if (child.nodeType === 1) {
        if (child.tagName.toLowerCase() === "br") {
          if (!isExcluded(child)) text += "\n";
          continue;
        }
        text += codeText(child);
      }
    }
    return text;
  }

  function tryEmitLeaf(element, tag) {
    if (element === titleElement) return;
    if (tag === "pre") {
      const text = codeText(element).replace(/^\n+|\s+$/g, "");
      tryEmit(element, tag, text, 0);
      return;
    }
    // Eligible text only: a heading or paragraph that is itself displayed
    // can still hold a hidden, aria-hidden, or non-content descendant, and
    // that descendant's text must not reach the emitted block just because
    // its ancestor is visible.
    const { text, density } = measureSegments(eligibleSegments(element));
    tryEmit(element, tag, text, density);
  }

  // A container's own text, emitted as blocks of the container's kind in
  // reading order: everything before a nested independent unit is one block,
  // the unit is collected next, and what follows it is another block of the
  // container's kind. A container with no such unit emits exactly one block.
  //
  // Link density is judged once, over all of the container's own text, and
  // that one value applies to every part. A trailing part that is nothing
  // but a link is therefore kept or dropped with the rest of the container,
  // exactly as when the container was a single block, rather than being
  // dropped alone for being a lone link. The untrimmed parts are measured
  // together, so the edges of the whole owned text are trimmed once rather
  // than per part. A container inside an anchor, or one with no plain text
  // in any part, is all link text. Each nested unit is judged by its own
  // ancestors.
  function collectContainer(element, tag) {
    const steps = [];
    const linked = isInsideAnchor(element);
    const last = ownedContent(element, linked, (unit, unitTag, part) => {
      steps.push({ part, unit, unitTag });
    });

    const parts = [...steps.map((step) => step.part), last];
    const { density } = measureSegments(
      parts.flatMap((part) => part.segments),
    );

    // Each part is a standalone block: its own two edges are trimmed here,
    // once, the same edge-trim every other emitted block gets.
    const emitPart = (part) => tryEmit(element, tag, part.text.trim(), density);

    for (const { part, unit, unitTag } of steps) {
      emitPart(part);
      if (CONTAINER_TAGS.has(unitTag)) {
        collectContainer(unit, unitTag);
      } else {
        tryEmitLeaf(unit, unitTag);
      }
    }
    emitPart(last);
  }

  // The accepted root, walked top-down in document order. A semantic
  // container met on the way is handed whole to `collectContainer`, which
  // owns every ordinary `p` and loose text beneath it. `insideAnchor` marks
  // that this call's own buffered text (not a nested wrapper's) sits inside
  // an `<a>` — true when `collectBlocks` itself was entered on a
  // block-display anchor, or on a root inside an anchor — so the buffer is
  // judged as link text the same way `ownedContent` would judge it.
  //
  // A non-candidate, non-container element visited here is one of two
  // things. An element that renders inline — `strong`, `em`, `span`, `a`,
  // and the rest of what a page mixes into a run of prose rather than
  // stacks as blocks (`isInlineDisplay`) — or that generates no box of its
  // own (`isContentsDisplay`, `display: contents`) is not a boundary:
  // `processChildren` below is called again on it directly, in this same
  // buffer, so its children are collected exactly as if the wrapper were
  // not there. `Hello <strong>world</strong>!` stays one paragraph, and an
  // inline `<a>` contributes its own share of the buffer's link text rather
  // than standing alone as a 100%-link paragraph. A paragraph, a heading or
  // a block-level wrapper inside it is not absorbed into the run: it keeps
  // its own block boundary and its own link-density decision, and is
  // emitted by the same recursive call. Anything else — a `dl`, a `dt`,
  // a `figcaption`, or any other wrapper that renders as a block of its own
  // — is not itself a text-owning unit the way a container is: it is
  // walked by this same function, one level deeper, so its own direct text
  // is buffered and emitted as a `paragraph` at exactly the point it is
  // encountered, in document order, and its candidate/container
  // descendants are still found and emitted as their own blocks, never
  // folded into the wrapper's text.
  function collectBlocks(node, insideAnchor) {
    // Ordered segments of the current prose run, each marked with whether it
    // is link text.
    let buffer = [];

    // Inside an anchor, everything buffered here is link text, separators
    // included. So is a buffer with no plain text.
    function flush() {
      const { text, density } = measureSegments(buffer);
      buffer = [];
      if (text.length === 0) return;
      tryEmit(node, "p", text, density);
    }

    // `parentHidden` is `parent`'s own effective visibility: it gates only
    // `parent`'s direct text nodes, which carry no style of their own. A
    // direct `<br>` has its own and is judged by it. The loop gates recursion
    // by `isStructurallyExcluded` alone, never by visibility, so an inline
    // or `display: contents` child's own visibility override (passed back in
    // below) or a candidate/container's own visibility (resolved
    // independently by `tryEmitLeaf`/`collectContainer` through
    // `eligibleSegments`/`ownedContent`) is still found rather than assumed
    // hidden along with an ancestor.
    //
    // `insideAnchor` here shadows the outer parameter of the same name: an
    // inline or `display: contents` wrapper walked in place can still be the
    // `<a>` itself, and its own anchor-ness must reach whatever text its
    // children contribute to this same buffer, so it is updated here before
    // recursing into its own children one level deeper, in place.
    function processChildren(parent, parentHidden, insideAnchor) {
      for (const child of parent.childNodes) {
        if (child.nodeType === 3) {
          if (!parentHidden) {
            buffer.push({ text: child.textContent, linked: insideAnchor });
          }
          continue;
        }
        if (child.nodeType !== 1) continue;
        if (isStructurallyExcluded(child)) continue;

        const tag = child.tagName.toLowerCase();

        if (tag === "br") {
          if (!isVisibilityHidden(child)) {
            buffer.push({ text: "\n", linked: insideAnchor });
          }
          continue;
        }

        if (!CANDIDATE_TAGS.has(tag)) {
          if (isInlineDisplay(child) || isContentsDisplay(child)) {
            processChildren(
              child,
              isOwnTextHidden(child),
              insideAnchor || tag === "a",
            );
            continue;
          }
        }

        flush();

        if (tag === "p") {
          tryEmitLeaf(child, tag);
          continue;
        }
        if (CONTAINER_TAGS.has(tag)) {
          collectContainer(child, tag);
          continue;
        }
        if (CANDIDATE_TAGS.has(tag)) {
          tryEmitLeaf(child, tag);
          continue;
        }
        collectBlocks(child, insideAnchor || tag === "a");
      }
    }

    processChildren(node, isOwnTextHidden(node), insideAnchor);
    flush();
  }

  collectFromRoot(root);

  return { title, blocks };
}

webDigestExtract(document);
