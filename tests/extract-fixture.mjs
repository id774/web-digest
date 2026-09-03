// A hand-rolled fake DOM and a Node `vm` loader for `src/extract/extract.js`.
//
// No third-party DOM library is added for this: the fixture only needs to
// support the small, fixed set of selectors extract.js actually uses (tag
// names, `[role="value"]`, and comma-separated lists of those — no
// combinators, no compound selectors), plus basic tree navigation. The
// loader runs the production file's own source, unmodified, through
// `node:vm` with a fake `document` as the sandbox's global — the same
// completion-value contract `chrome.scripting.executeScript` relies on, so
// this exercises the exact file that ships, not a copy of its logic.

import vm from "node:vm";
import { readFileSync } from "node:fs";

const EXTRACT_SOURCE = readFileSync(
  new URL("../src/extract/extract.js", import.meta.url),
  "utf8",
);

function matchesSelector(el, selectorList) {
  const parts = selectorList.split(",").map((s) => s.trim());
  for (const part of parts) {
    const attr = part.match(/^\[([a-zA-Z-]+)="([^"]*)"\]$/);
    if (attr) {
      const [, name, value] = attr;
      if (el.getAttribute(name) === value) return true;
    } else if (el.tagName === part.toLowerCase()) {
      return true;
    }
  }
  return false;
}

function collectMatches(node, selectorList, results, firstOnly) {
  for (const child of node.childNodes) {
    if (child.nodeType !== 1) continue;
    if (matchesSelector(child, selectorList)) {
      results.push(child);
      if (firstOnly) return true;
    }
    if (collectMatches(child, selectorList, results, firstOnly)) return true;
  }
  return false;
}

function queryAll(scope, selectorList) {
  const results = [];
  collectMatches(scope, selectorList, results, false);
  return results;
}

function queryFirst(scope, selectorList) {
  const results = [];
  collectMatches(scope, selectorList, results, true);
  return results[0] || null;
}

// A text node. `hidden` text (5.1 of the requirements this fixes) is
// represented the same way a real page holds it: as ordinary text inside an
// element the fixture marks hidden — never as a special node type.
export function text(content) {
  return { nodeType: 3, textContent: content };
}

// `attrs` may set `hidden: true`, `role`, `href`, or `style: { display,
// visibility }` to simulate what `getComputedStyle` would report. `children`
// is a mix of elements (from `el(...)`) and text nodes (from `text(...)`) —
// a bare string is accepted too, as shorthand for one text node.
export function el(tag, attrs = {}, children = []) {
  const { style, ...rest } = attrs;
  const node = {
    nodeType: 1,
    tagName: tag.toLowerCase(),
    hidden: attrs.hidden === true,
    _attrs: rest,
    _computedStyle: style || {},
    childNodes: [],
    parentElement: null,
    get children() {
      return this.childNodes.filter((c) => c.nodeType === 1);
    },
    get textContent() {
      let out = "";
      for (const child of this.childNodes) out += child.textContent;
      return out;
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this._attrs, name)
        ? String(this._attrs[name])
        : null;
    },
    matches(selectorList) {
      return matchesSelector(this, selectorList);
    },
    closest(selectorList) {
      for (let node = this; node; node = node.parentElement) {
        if (matchesSelector(node, selectorList)) return node;
      }
      return null;
    },
    querySelector(selectorList) {
      return queryFirst(this, selectorList);
    },
    querySelectorAll(selectorList) {
      return queryAll(this, selectorList);
    },
  };
  for (const child of children) {
    const childNode = typeof child === "string" ? text(child) : child;
    childNode.parentElement = node;
    node.childNodes.push(childNode);
  }
  return node;
}

// A page: `bodyChildren` become `<body>`'s children, inside a `<html>` root.
export function page(bodyChildren, { title = "" } = {}) {
  const body = el("body", {}, bodyChildren);
  const documentElement = el("html", {}, [body]);
  const doc = {
    title,
    body,
    documentElement,
    defaultView: {
      getComputedStyle(node) {
        return node._computedStyle || {};
      },
    },
    querySelector(selectorList) {
      return queryFirst(documentElement, selectorList);
    },
    querySelectorAll(selectorList) {
      return queryAll(documentElement, selectorList);
    },
  };
  return doc;
}

// Runs the real, unmodified extract.js source against `doc`, the same way
// chrome.scripting.executeScript would: `document` is the sandbox's global,
// and the script's own completion value — webDigestExtract(document)'s
// return value — is what comes back. structuredClone crosses it out of the
// vm context's own realm, the same as the structured-clone boundary a real
// injected script's result crosses to reach `results[0].result` — without
// it, arrays and objects here would carry that realm's own Array/Object
// prototypes, and assert.deepStrictEqual would see two same-shaped values
// as not equal.
export function runExtract(doc) {
  const context = vm.createContext({ document: doc });
  const result = vm.runInContext(EXTRACT_SOURCE, context, {
    filename: "extract.js",
  });
  return structuredClone(result);
}
