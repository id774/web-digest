// The side panel: it asks for the state and renders it.
//
// The panel decides nothing. It holds no copy of a setting and no token, it
// performs no extraction and it makes no request to any AI provider.

import { ErrorKind, messageFor } from "../common/errors.js";
import { MessageType } from "../common/messages.js";
import {
  diagnosticsKey,
  formatDiagnostics,
  sanitizeRecord,
} from "../common/diagnostics.js";

const elements = {
  title: document.getElementById("title"),
  status: document.getElementById("status"),
  summary: document.getElementById("summary"),
  sections: document.getElementById("sections"),
  highlights: document.getElementById("highlights"),
  summaryBody: document.getElementById("summary-body"),
  openSettings: document.getElementById("open-settings"),
  settings: document.getElementById("settings"),
  diagnostics: document.getElementById("diagnostics"),
  diagnosticsText: document.getElementById("diagnostics-text"),
};

// The tab this panel currently follows, and the generation of that binding:
// every rebind — the initial one included — starts a new generation, so an
// async completion that belongs to an earlier one can always be told apart
// from the current one and ignored, whatever order they actually settle in.
// The side panel document itself is not reloaded on an ordinary tab switch,
// so this tracking is what makes the panel follow the active tab rather than
// the one it happened to load for.
let currentTabId = null;
let bindGeneration = 0;
// Bumped on every call to followActiveTab, independently of bindGeneration:
// the tab-activation query itself is asynchronous, so two overlapping calls
// (fired by two onActivated events in quick succession) can have their
// browser-side queries settle in either order. Only the completion whose
// call started last is allowed to act — an earlier call's query resolving
// after a later one has already started is exactly the stale-tab regression
// this guards against, regardless of which tab either query actually names.
let tabLookupGeneration = 0;
// Reset on every rebind: set once a live stateChanged for the *current*
// binding has been rendered, so the snapshot request that binding started
// with — issued before that update was known to exist — can never overwrite
// it by resolving late.
let liveSeenThisGeneration = false;
// The tab's diagnostics, when it has any, and the phase last rendered for it.
// The record is shown as text beside the summary, never in place of it. It is
// bound to the same tab and the same generation as the state, and reset with
// them, so one tab's record is never shown for another.
let currentDiagnostics = null;
let renderedPhase = "idle";
let diagnosticsLiveSeenThisGeneration = false;

function show(element, text) {
  // Nothing from the page and nothing from the model becomes markup.
  element.textContent = text;
  element.hidden = text === "";
}

// Recognizes the fixed final-result layout and nothing else: the line
// HIGHLIGHTS, one to three non-empty lines, one blank line, the line SUMMARY,
// then a non-empty body. Only line-ending and surrounding-whitespace
// differences are tolerated. It judges the shape, never the meaning, and
// returns null for anything else so the caller can show the text as it is.
function parseSections(text) {
  if (typeof text !== "string") return null;
  const lines = text.replace(/\r\n?/g, "\n").trim().split("\n");
  if (lines[0].trim() !== "HIGHLIGHTS") return null;
  let end = 1;
  while (end < lines.length && lines[end].trim() !== "") end += 1;
  const count = end - 1;
  if (count < 1 || count > 3) return null;
  if (lines[end + 1] === undefined || lines[end + 1].trim() !== "SUMMARY") {
    return null;
  }
  const body = lines.slice(end + 2).join("\n").trim();
  if (body === "") return null;
  const highlights = lines.slice(1, end).map((line) => line.trim());
  // The panel draws the bullets itself, so a line that already carries a list
  // marker is not the specified layout and is shown as it is instead.
  if (highlights.some((line) => /^([-*+\u2022]|\d+[.)])\s/.test(line))) {
    return null;
  }
  return { highlights, body };
}

function clearSections() {
  elements.highlights.replaceChildren();
  show(elements.summaryBody, "");
  elements.sections.hidden = true;
}

function showSummary(text) {
  const parsed = parseSections(text);
  if (!parsed) {
    clearSections();
    show(elements.summary, typeof text === "string" ? text : "");
    return;
  }
  show(elements.summary, "");
  elements.highlights.replaceChildren(
    ...parsed.highlights.map((point) => {
      const item = document.createElement("li");
      item.textContent = point;
      return item;
    }),
  );
  show(elements.summaryBody, parsed.body);
  elements.sections.hidden = false;
}

function renderDiagnostics() {
  // A record with no events and nothing dropped says nothing: it is what
  // stands in for a record the worker could not remove.
  if (
    !currentDiagnostics ||
    (currentDiagnostics.events.length === 0 && currentDiagnostics.dropped === 0)
  ) {
    show(elements.diagnosticsText, "");
    elements.diagnostics.hidden = true;
    return;
  }
  const finished = renderedPhase === "succeeded" || renderedPhase === "failed";
  show(elements.diagnosticsText, formatDiagnostics(currentDiagnostics, { finished }));
  elements.diagnostics.hidden = false;
}

function render(state) {
  renderedPhase = state && state.phase ? state.phase : "idle";
  // A tab with no run has no diagnostics, whatever was last shown for it.
  if (renderedPhase === "idle") currentDiagnostics = null;
  renderState(state);
  renderDiagnostics();
}

function renderState(state) {
  const phase = state && state.phase ? state.phase : "idle";

  show(elements.title, state && state.title ? state.title : "");
  elements.openSettings.hidden = true;

  if (phase === "running") {
    show(elements.summary, "");
    clearSections();
    show(elements.status, "Summarizing… this can take a while.");
    return;
  }

  if (phase === "succeeded") {
    show(elements.status, "");
    showSummary(state.summary || "");
    return;
  }

  if (phase === "failed") {
    show(elements.summary, "");
    clearSections();
    show(elements.status, messageFor(state.errorKind, state.errorDetail));
    elements.openSettings.hidden = ![
      ErrorKind.CREDENTIAL_MISSING,
      ErrorKind.PERMISSION_MISSING,
    ].includes(state.errorKind);
    return;
  }

  show(elements.summary, "");
  clearSections();
  show(elements.status, "No summary has been run for this tab yet.");
}

// What the panel renders when it could not learn a tab's state itself — a
// query or a message failed — rather than when that tab simply has none
// yet. The existing internal-error wording is reused rather than inventing
// one, and this is never written to storage: it is what render() shows,
// nothing a getState response or a stateChanged broadcast ever carries.
function internalErrorState() {
  return {
    phase: "failed",
    title: "",
    summary: "",
    errorKind: ErrorKind.INTERNAL_ERROR,
    errorDetail: "",
  };
}

function openOptions() {
  chrome.runtime.openOptionsPage().catch(() => {
    // Bounded and local: the stored RunState is untouched, and nothing about
    // the failed attempt — an exception, a reason — reaches this line.
    show(elements.status, messageFor(ErrorKind.INTERNAL_ERROR, ""));
  });
}

elements.settings.addEventListener("click", openOptions);
elements.openSettings.addEventListener("click", openOptions);

async function requestState(tabId) {
  return await chrome.runtime.sendMessage({
    type: MessageType.GET_STATE,
    tabId,
  });
}

// Invalidates whatever tab this panel is currently bound to, without
// binding to a replacement. Called only when active-tab identity itself
// cannot be confirmed — a rejected active-tab query, or one that resolves
// with no valid tab id — never on an ordinary rebind, which goes through
// bindTo below instead. Advancing bindGeneration here is what turns a
// pending snapshot requested by the invalidated binding into a stale one:
// its own generation check can no longer match once this has run. Clearing
// currentTabId is what stops a stateChanged for that same old tab from
// still being accepted as the current binding's own live update.
function invalidateBinding() {
  currentTabId = null;
  bindGeneration += 1;
  liveSeenThisGeneration = false;
  currentDiagnostics = null;
  diagnosticsLiveSeenThisGeneration = false;
}

// Reads this binding's diagnostics once. Like the state snapshot, it is
// ignored if the binding has changed, or a live change has already been
// shown, by the time it settles. A read that fails shows nothing.
async function loadDiagnostics(tabId, generation) {
  const key = diagnosticsKey(tabId);
  let stored;
  try {
    stored = await chrome.storage.session.get(key);
  } catch {
    return;
  }
  if (generation !== bindGeneration || diagnosticsLiveSeenThisGeneration) return;
  currentDiagnostics = sanitizeRecord(stored && stored[key]);
  renderDiagnostics();
}

// Binds to `tabId`: starts a new generation, fetches its current snapshot,
// and renders it — unless a live update for this same binding, or a newer
// binding started since, has already made that snapshot stale by the time
// it settles. This applies identically whether the snapshot request
// resolves or rejects: a live `stateChanged` already rendered for this
// binding is newer information than either outcome of a request issued
// before that update was known to exist, so neither a late resolve nor a
// late rejection may replace what the live update already put on screen.
async function bindTo(tabId) {
  bindGeneration += 1;
  const generation = bindGeneration;
  currentTabId = tabId;
  liveSeenThisGeneration = false;
  currentDiagnostics = null;
  diagnosticsLiveSeenThisGeneration = false;
  loadDiagnostics(tabId, generation);

  function stale() {
    return generation !== bindGeneration || liveSeenThisGeneration;
  }

  let snapshot;
  try {
    snapshot = await requestState(tabId);
  } catch {
    if (stale()) return;
    render(internalErrorState());
    return;
  }
  if (stale()) return;
  render(snapshot);
}

// Re-checks this panel's own window's active tab and rebinds to it if it
// changed. A tab id is read the same way the original load did — without
// the tabs permission, no field but the id is used — so this adds no
// permission and starts no run, no extraction and no page read of its own.
async function followActiveTab() {
  tabLookupGeneration += 1;
  const lookupGeneration = tabLookupGeneration;

  let tabId = null;
  try {
    const tabs = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const tab = tabs && tabs[0];
    tabId = tab && typeof tab.id === "number" ? tab.id : null;
  } catch {
    if (lookupGeneration !== tabLookupGeneration) return;
    invalidateBinding();
    render(internalErrorState());
    return;
  }
  if (lookupGeneration !== tabLookupGeneration) return;
  if (tabId === null) {
    invalidateBinding();
    render(null);
    return;
  }
  if (tabId === currentTabId) return;
  await bindTo(tabId);
}

// Re-render on each stateChanged for the tab this panel is currently bound
// to, and ignore every other tab's — including one this panel used to
// follow before a rebind.
chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== MessageType.STATE_CHANGED) return;
  if (message.tabId !== currentTabId) return;
  liveSeenThisGeneration = true;
  render(message.state);
});

// A change to the bound tab's diagnostics in session storage, and only that
// one, is shown as it lands. A removal clears the display.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "session" || currentTabId === null) return;
  const change = changes[diagnosticsKey(currentTabId)];
  if (!change) return;
  diagnosticsLiveSeenThisGeneration = true;
  currentDiagnostics = sanitizeRecord(change.newValue);
  renderDiagnostics();
});

// tabs.onActivated carries only a tabId and a windowId, never a URL or a
// title, so it needs no permission beyond what this extension already has.
// Firing for a window other than this panel's own is harmless: the
// `currentWindow: true` query in followActiveTab still resolves to this
// panel's own already-current tab, so that call is a no-op.
chrome.tabs.onActivated.addListener(() => {
  followActiveTab();
});

// A replacement retires removedTabId as a tab identity. If this panel was
// bound to it, that binding is invalidated first — the same way an
// active-tab query failure invalidates one — so a still-pending snapshot or
// a late stateChanged for it can no longer be accepted as current. The
// added identity is never bound to directly: followActiveTab re-queries the
// actual active tab, which also covers a non-active replacement as a no-op.
chrome.tabs.onReplaced.addListener((_addedTabId, removedTabId) => {
  if (removedTabId === currentTabId) invalidateBinding();
  followActiveTab();
});

followActiveTab();
