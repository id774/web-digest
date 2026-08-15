// The side panel: it asks for the state, renders it, and sends run.
//
// The panel decides nothing. It holds no copy of a setting and no token, it
// performs no extraction and it makes no request to the AI Engine.

import { ErrorKind, messageFor } from "../common/errors.js";
import { MessageType } from "../common/messages.js";

const elements = {
  title: document.getElementById("title"),
  status: document.getElementById("status"),
  summary: document.getElementById("summary"),
  run: document.getElementById("run"),
  openSettings: document.getElementById("open-settings"),
  settings: document.getElementById("settings"),
};

let tabId = null;

function show(element, text) {
  // Nothing from the page and nothing from the model becomes markup.
  element.textContent = text;
  element.hidden = text === "";
}

function render(state) {
  const phase = state && state.phase ? state.phase : "idle";

  show(elements.title, state && state.title ? state.title : "");
  elements.openSettings.hidden = true;
  elements.run.disabled = false;

  if (phase === "running") {
    show(elements.summary, "");
    show(elements.status, "Summarizing… this can take a while.");
    elements.run.textContent = "Summarize this page";
    elements.run.disabled = true;
    return;
  }

  if (phase === "succeeded") {
    show(elements.status, "");
    show(elements.summary, state.summary || "");
    elements.run.textContent = "Summarize again";
    return;
  }

  if (phase === "failed") {
    show(elements.summary, "");
    show(elements.status, messageFor(state.errorKind, state.errorDetail));
    elements.run.textContent = "Try again";
    elements.openSettings.hidden = state.errorKind !== ErrorKind.TOKEN_MISSING;
    return;
  }

  show(elements.summary, "");
  show(elements.status, "No summary has been run for this tab yet.");
  elements.run.textContent = "Summarize this page";
}

function openOptions() {
  chrome.runtime.openOptionsPage();
}

elements.settings.addEventListener("click", openOptions);
elements.openSettings.addEventListener("click", openOptions);

elements.run.addEventListener("click", () => {
  if (tabId === null) return;
  chrome.runtime
    .sendMessage({ type: MessageType.RUN, tabId })
    .catch(() => {});
});

// Re-render on each stateChanged for this tab, and ignore the others.
chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== MessageType.STATE_CHANGED) return;
  if (message.tabId !== tabId) return;
  render(message.state);
});

// This yields a tab id without the tabs permission. No other field is read.
chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
  const tab = tabs && tabs[0];
  if (!tab || typeof tab.id !== "number") {
    render(null);
    return;
  }
  tabId = tab.id;
  chrome.runtime
    .sendMessage({ type: MessageType.GET_STATE, tabId })
    .then(render)
    .catch(() => render(null));
});
