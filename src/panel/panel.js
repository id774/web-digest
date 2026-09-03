// The side panel: it asks for the state and renders it.
//
// The panel decides nothing. It holds no copy of a setting and no token, it
// performs no extraction and it makes no request to the AI Engine.

import { ErrorKind, messageFor } from "../common/errors.js";
import { MessageType } from "../common/messages.js";

const elements = {
  title: document.getElementById("title"),
  status: document.getElementById("status"),
  summary: document.getElementById("summary"),
  openSettings: document.getElementById("open-settings"),
  settings: document.getElementById("settings"),
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
// Reset on every rebind: set once a live stateChanged for the *current*
// binding has been rendered, so the snapshot request that binding started
// with — issued before that update was known to exist — can never overwrite
// it by resolving late.
let liveSeenThisGeneration = false;

function show(element, text) {
  // Nothing from the page and nothing from the model becomes markup.
  element.textContent = text;
  element.hidden = text === "";
}

function render(state) {
  const phase = state && state.phase ? state.phase : "idle";

  show(elements.title, state && state.title ? state.title : "");
  elements.openSettings.hidden = true;

  if (phase === "running") {
    show(elements.summary, "");
    show(elements.status, "Summarizing… this can take a while.");
    return;
  }

  if (phase === "succeeded") {
    show(elements.status, "");
    show(elements.summary, state.summary || "");
    return;
  }

  if (phase === "failed") {
    show(elements.summary, "");
    show(elements.status, messageFor(state.errorKind, state.errorDetail));
    elements.openSettings.hidden = ![
      ErrorKind.CREDENTIAL_MISSING,
      ErrorKind.PERMISSION_MISSING,
    ].includes(state.errorKind);
    return;
  }

  show(elements.summary, "");
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

// Binds to `tabId`: starts a new generation, fetches its current snapshot,
// and renders it — unless a live update for this same binding, or a newer
// binding started since, has already made that snapshot stale by the time
// it resolves.
async function bindTo(tabId) {
  bindGeneration += 1;
  const generation = bindGeneration;
  currentTabId = tabId;
  liveSeenThisGeneration = false;

  let snapshot;
  try {
    snapshot = await requestState(tabId);
  } catch {
    if (generation !== bindGeneration) return;
    render(internalErrorState());
    return;
  }
  if (generation !== bindGeneration) return;
  if (liveSeenThisGeneration) return;
  render(snapshot);
}

// Re-checks this panel's own window's active tab and rebinds to it if it
// changed. A tab id is read the same way the original load did — without
// the tabs permission, no field but the id is used — so this adds no
// permission and starts no run, no extraction and no page read of its own.
async function followActiveTab() {
  let tabId = null;
  try {
    const tabs = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const tab = tabs && tabs[0];
    tabId = tab && typeof tab.id === "number" ? tab.id : null;
  } catch {
    render(internalErrorState());
    return;
  }
  if (tabId === null) {
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

// tabs.onActivated carries only a tabId and a windowId, never a URL or a
// title, so it needs no permission beyond what this extension already has.
// Firing for a window other than this panel's own is harmless: the
// `currentWindow: true` query in followActiveTab still resolves to this
// panel's own already-current tab, so that call is a no-op.
chrome.tabs.onActivated.addListener(() => {
  followActiveTab();
});

followActiveTab();
