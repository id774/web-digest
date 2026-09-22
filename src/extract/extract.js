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

  // Every reason a subtree is skipped *whole* — nothing inside it is ever
  // examined once one of these holds, because nothing inside can undo it.
  // `hidden`, `aria-hidden` and a computed `display: none` are structural
  // this way; so is being furniture, non-content, or a page-banner header,
  // since no CSS a descendant carries lets it stop being any of those.
  function isStructurallyExcluded(element) {
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
      if (node.hidden === true) return true;
      if (node.getAttribute && node.getAttribute("aria-hidden") === "true") {
        return true;
      }
      if (view && typeof view.getComputedStyle === "function") {
        const style = view.getComputedStyle(node);
        if (style && style.display === "none") return true;
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
  // The recursive walk (`rawEligibleText`) never trims: an inner call's
  // result is a fragment being concatenated into its parent's text, not a
  // standalone value, so trimming it there would drop authored whitespace
  // sitting at exactly a descendant's own boundary — `Hello<strong>
  // world</strong>` losing `strong`'s own leading space, the same defect
  // `ownedContent` was fixed for. Only the outermost call, `eligibleText`
  // itself, trims — once, at the two edges of the whole result.
  function eligibleText(element) {
    return rawEligibleText(element).trim();
  }

  // Recursion into a child element happens unconditionally here — never
  // gated by `element`'s own visibility — because the child gets its own
  // independent `isStructurallyExcluded`/`isVisibilityHidden` check the
  // moment this function is called on it; only `element`'s own direct text
  // nodes, which carry no style of their own, borrow `element`'s effective
  // visibility to decide whether they count.
  function rawEligibleText(element) {
    if (isStructurallyExcluded(element)) return "";
    const ownContentHidden = isVisibilityHidden(element);
    let text = "";
    for (const child of element.childNodes) {
      if (child.nodeType === 3) {
        if (!ownContentHidden) text += child.textContent;
      } else if (child.nodeType === 1) {
        // A visible line break is a text boundary an author actually wrote:
        // `foo<br>bar` must not read as `foobar` once these two runs are
        // concatenated. Later shaping is free to fold this into a space with
        // every other line break; only the boundary must survive here.
        if (child.tagName.toLowerCase() === "br") {
          if (!ownContentHidden && !isExcluded(child)) text += "\n";
          continue;
        }
        text += rawEligibleText(child);
      }
    }
    return text;
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
  //
  // Text nodes are concatenated in DOM order with no separator inserted
  // between them: an inline element boundary is not by itself a reason for a
  // space to appear, so `前<strong>後</strong>。` stays `前後。` and
  // `<a>docs</a>.` stays `docs.` rather than gaining artificial spaces. Any
  // whitespace an author actually wrote is preserved here and left to later
  // shaping to normalize; only the two edges of the whole returned text are
  // trimmed.
  //
  // `insideAnchor` seeds whether `element` itself is already inside an
  // anchor's link text: `collectBlocks` below calls this directly on an
  // inline element that may itself be the `<a>`, whose own direct text the
  // internal walk would otherwise miss, since the walk only turns the flag
  // on for a descendant tagged `a`, never for the element it starts from.
  //
  // The returned `text` is untrimmed: whether an edge of it is significant
  // depends on where the caller puts it. A container emitting its own
  // standalone block trims once, at that point (`tryEmitContainer`); an
  // inline element being absorbed into a surrounding prose run must not
  // trim at all, or authored whitespace at exactly its own boundary —
  // `Hello<strong> world</strong>` — is lost before the concatenation that
  // needed it ever happens.
  function ownedContent(element, insideAnchor = false) {
    let text = "";
    let linkChars = 0;

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
          text += segment;
          if (insideAnchor) linkChars += segment.length;
          continue;
        }
        if (child.nodeType !== 1) continue;
        if (isStructurallyExcluded(child)) continue;
        const tag = child.tagName.toLowerCase();
        const childHidden = isVisibilityHidden(child);
        // Same visible-boundary rule as eligibleText: a `<br>` must not let
        // two authored text runs merge into one word.
        if (tag === "br") {
          if (!hiddenBySelf && !childHidden) text += "\n";
          continue;
        }
        if (INDEPENDENT_UNIT_TAGS.has(tag)) continue;
        walk(child, insideAnchor || tag === "a", childHidden);
      }
    }

    walk(element, insideAnchor, isVisibilityHidden(element));
    return { text, linkChars };
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

  const root = chooseRoot();

  // The page's own heading, where document.title usually carries the site name
  // as well. An h1 used as the title is not also emitted as a heading block.
  // The same eligibility rule that decides block collection decides this: an
  // h1 that is itself excluded, or that holds no eligible text of its own, is
  // never the title just for being the first one in the document — the
  // search keeps going to the next h1, and falls back to document.title if
  // none qualifies.
  let title = "";
  let titleElement = null;
  const headingCandidates = root.querySelectorAll
    ? root.querySelectorAll("h1")
    : [];
  for (const candidate of headingCandidates) {
    if (isExcluded(candidate)) continue;
    const text = eligibleText(candidate);
    if (text.length === 0) continue;
    title = text;
    titleElement = candidate;
    break;
  }
  if (!titleElement && typeof doc.title === "string" && doc.title.trim().length > 0) {
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

  // `pre`'s own verbatim collection: every text node's content is kept
  // exactly, including line breaks and indentation, but a descendant element
  // is still subject to the same exclusion `isExcluded` applies everywhere
  // else, so a hidden, aria-hidden, furniture or non-content descendant
  // cannot leak into a code block the way raw `element.textContent` would
  // let it. Internal whitespace is never normalized here; only the
  // block-edge trim below still applies to the result. A visible `<br>` is
  // the same authored line-break boundary it is in ordinary prose — code
  // keeps line breaks as meaningful content, so `<pre>foo<br>bar</pre>` is
  // `foo\nbar`, never `foobar`.
  function codeText(element) {
    if (isStructurallyExcluded(element)) return "";
    const ownContentHidden = isVisibilityHidden(element);
    let text = "";
    for (const child of element.childNodes) {
      if (child.nodeType === 3) {
        if (!ownContentHidden) text += child.textContent;
      } else if (child.nodeType === 1) {
        if (child.tagName.toLowerCase() === "br") {
          if (!ownContentHidden && !isExcluded(child)) text += "\n";
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
    const text = eligibleText(element);
    const density = eligibleLinkDensity(element, text);
    tryEmit(element, tag, text, density);
  }

  function tryEmitContainer(element, tag) {
    const owned = ownedContent(element);
    // A container is a standalone block: its own two edges are trimmed
    // here, once, the same edge-trim every other emitted block gets.
    const text = owned.text.trim();
    const density = text.length === 0 ? 0 : owned.linkChars / text.length;
    tryEmit(element, tag, text, density);
  }

  // The accepted root, walked top-down in document order. `absorbingP` is
  // true once inside a semantic container whose own block already owns every
  // ordinary `p` beneath it — so those `p`s are searched for nested
  // independent units, never re-emitted as paragraphs of their own, and any
  // loose text directly inside that subtree is likewise already part of the
  // container's own text (`ownedContent` merges it), never buffered again
  // here. `insideAnchor` marks that this call's own buffered text (not a
  // nested wrapper's) sits inside an `<a>` — true when `collectBlocks`
  // itself was entered on a block-display anchor — so `bufferLinkChars`
  // below can count it as link text the same way `ownedContent` would.
  //
  // A non-candidate, non-container element visited here is one of three
  // things. An element that renders inline — `strong`, `em`, `span`, `a`,
  // and the rest of what a page mixes into a run of prose rather than
  // stacks as blocks (`isInlineDisplay`) — contributes its own owned
  // content (by the same rule `ownedContent` already applies inside a
  // container) straight into the buffer this same prose run is being
  // collected into, so `Hello <strong>world</strong>!` stays one paragraph
  // and an inline `<a>` contributes its own share of `bufferLinkChars`
  // rather than standing alone as a 100%-link paragraph. An element that
  // generates no box of its own (`isContentsDisplay`, `display: contents`)
  // is not a boundary at all: `processChildren` below is called again on
  // it directly, in this same buffer, so its children are collected exactly
  // as if the wrapper were not there — a `<span style="display:contents">`
  // around plain text never flushes the run in two around itself, while a
  // heading or other independent unit inside it is still found and emitted
  // on its own, by the same recursive call. Anything else — a `dl`, a `dt`,
  // a `figcaption`, or any other wrapper that renders as a block of its own
  // — is not itself a text-owning unit the way a container is: it is
  // walked by this same function, one level deeper, so its own direct text
  // is buffered and emitted as a `paragraph` at exactly the point it is
  // encountered, in document order, and its candidate/container
  // descendants are still found and emitted as their own blocks, never
  // folded into the wrapper's text.
  function collectBlocks(node, absorbingP, insideAnchor) {
    let buffer = "";
    let bufferLinkChars = 0;

    function flush() {
      const text = buffer.trim();
      const linkChars = bufferLinkChars;
      buffer = "";
      bufferLinkChars = 0;
      if (text.length === 0) return;
      tryEmit(node, "p", text, linkChars / text.length);
    }

    // `parentHidden` is `parent`'s own effective visibility: it gates only
    // `parent`'s direct text nodes and a direct `<br>`, which carry no
    // style of their own. The loop gates recursion by
    // `isStructurallyExcluded` alone, never by visibility, so a `display:
    // contents` child's own visibility override (passed back in below) or
    // a candidate/container's own visibility (resolved independently by
    // `tryEmitLeaf`/`tryEmitContainer` through `eligibleText`/
    // `ownedContent`) is still found rather than assumed hidden along with
    // an ancestor.
    //
    // `insideAnchor` here shadows the outer parameter of the same name: a
    // `display: contents` element has no box, but it can still be the
    // `<a>` itself, and its own anchor-ness must reach whatever text its
    // children contribute to this same buffer — an ordinary inline `<a>`
    // updates this before merging via `ownedContent`, and a `display:
    // contents` `<a>` must update it here for the very same reason before
    // recursing into its own children one level deeper, in place.
    function processChildren(parent, parentHidden, insideAnchor) {
      for (const child of parent.childNodes) {
        if (child.nodeType === 3) {
          if (!absorbingP && !parentHidden) {
            buffer += child.textContent;
            if (insideAnchor) bufferLinkChars += child.textContent.length;
          }
          continue;
        }
        if (child.nodeType !== 1) continue;
        if (isStructurallyExcluded(child)) continue;

        const tag = child.tagName.toLowerCase();

        if (tag === "br") {
          if (!absorbingP && !parentHidden && !isVisibilityHidden(child)) {
            buffer += "\n";
          }
          continue;
        }

        if (!absorbingP && !CANDIDATE_TAGS.has(tag)) {
          if (isInlineDisplay(child)) {
            const owned = ownedContent(child, insideAnchor || tag === "a");
            buffer += owned.text;
            bufferLinkChars += owned.linkChars;
            continue;
          }
          if (isContentsDisplay(child)) {
            processChildren(
              child,
              isVisibilityHidden(child),
              insideAnchor || tag === "a",
            );
            continue;
          }
        }

        flush();

        if (tag === "p") {
          if (absorbingP) {
            collectBlocks(child, true, false);
          } else {
            tryEmitLeaf(child, tag);
          }
          continue;
        }
        if (CONTAINER_TAGS.has(tag)) {
          tryEmitContainer(child, tag);
          collectBlocks(child, true, false);
          continue;
        }
        if (CANDIDATE_TAGS.has(tag)) {
          tryEmitLeaf(child, tag);
          continue;
        }
        collectBlocks(child, absorbingP, insideAnchor || tag === "a");
      }
    }

    processChildren(node, isVisibilityHidden(node), insideAnchor);
    flush();
  }

  collectBlocks(root, false, false);

  return { title, blocks };
}

webDigestExtract(document);
