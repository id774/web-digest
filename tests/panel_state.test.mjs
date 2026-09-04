import test from "node:test";
import assert from "node:assert/strict";

import { ErrorKind, messageFor } from "../src/common/errors.js";
import { MessageType } from "../src/common/messages.js";
import {
  failedState,
  idleState,
  runningState,
  succeededState,
} from "../src/background/service_worker.js";

// panel.js has no exports of its own — it is driven entirely through the
// fake chrome APIs it calls, matching how a real side panel document is
// driven only by Chrome's own event and message dispatch. The panel module
// is re-imported fresh (cache-busted) for each test, with a fresh fake
// chrome and document installed first, since it wires everything up at
// import time.

function makeElement() {
  return {
    textContent: "",
    hidden: false,
    _listeners: {},
    addEventListener(type, fn) {
      this._listeners[type] = fn;
    },
  };
}

function makeFakeDocument() {
  const ids = ["title", "status", "summary", "open-settings", "settings"];
  const elements = {};
  for (const id of ids) elements[id] = makeElement();
  return { elements, getElementById: (id) => elements[id] };
}

function makeFakeChrome(initialActiveTabId = 1) {
  const listeners = {};
  const calls = [];
  const pendingSendMessage = [];
  // Held open only once a test calls setHoldTabsQuery(true) — every other
  // test keeps the original, immediately-resolving behavior. This is what
  // lets the reversed-completion race test below start two overlapping
  // chrome.tabs.query() calls and settle them in either order by hand.
  const pendingTabsQuery = [];
  let activeTabId = initialActiveTabId;
  let holdTabsQuery = false;

  const chrome = {
    runtime: {
      onMessage: { addListener: (fn) => (listeners.message = fn) },
      sendMessage: (message) => {
        calls.push(["sendMessage", message]);
        return new Promise((resolve, reject) => {
          pendingSendMessage.push({ message, resolve, reject });
        });
      },
      openOptionsPage: (...args) => {
        calls.push(["openOptionsPage"]);
        return chrome.runtime._openOptionsImpl(...args);
      },
      _openOptionsImpl: () => Promise.resolve(),
    },
    tabs: {
      query: (query) => {
        calls.push(["tabsQuery", query]);
        if (!holdTabsQuery) return chrome.tabs._queryImpl(query);
        return new Promise((resolve, reject) => {
          pendingTabsQuery.push({ query, resolve, reject });
        });
      },
      _queryImpl: async () =>
        activeTabId === null ? [] : [{ id: activeTabId }],
      onActivated: { addListener: (fn) => (listeners.activated = fn) },
    },
  };

  return {
    chrome,
    listeners,
    calls,
    pendingSendMessage,
    pendingTabsQuery,
    setActiveTab(id) {
      activeTabId = id;
    },
    setHoldTabsQuery(value) {
      holdTabsQuery = value;
    },
  };
}

async function loadPanel(chrome, document) {
  globalThis.chrome = chrome;
  globalThis.document = document;
  await import(`../src/panel/panel.js?panel-state-${Math.random()}`);
}

async function flushUntil(predicate, maxTicks = 200) {
  for (let i = 0; i < maxTicks && !predicate(); i++) {
    await Promise.resolve();
  }
  assert.ok(predicate(), "condition was not met within the tick budget");
}

function cleanup() {
  delete globalThis.chrome;
  delete globalThis.document;
}

test("the panel follows a switch to a new active tab and does not keep the old tab's summary", async () => {
  const fake = makeFakeChrome(1);
  const doc = makeFakeDocument();
  try {
    await loadPanel(fake.chrome, doc);

    await flushUntil(() => fake.pendingSendMessage.length === 1);
    fake.pendingSendMessage
      .shift()
      .resolve(succeededState("Tab A title", "Tab A summary"));
    await flushUntil(() => doc.elements.summary.textContent !== "");

    assert.equal(doc.elements.summary.textContent, "Tab A summary");
    assert.equal(doc.elements.title.textContent, "Tab A title");

    fake.setActiveTab(2);
    fake.listeners.activated();

    await flushUntil(() => fake.pendingSendMessage.length === 1);
    fake.pendingSendMessage.shift().resolve(idleState());
    await flushUntil(() => doc.elements.summary.textContent === "");

    assert.equal(doc.elements.summary.textContent, "");
    assert.equal(doc.elements.summary.hidden, true);
    assert.equal(doc.elements.title.textContent, "");
    assert.equal(
      doc.elements.status.textContent,
      "No summary has been run for this tab yet.",
    );
  } finally {
    cleanup();
  }
});

test("switching to a tab with its own existing state shows that state", async () => {
  const fake = makeFakeChrome(1);
  const doc = makeFakeDocument();
  try {
    await loadPanel(fake.chrome, doc);
    await flushUntil(() => fake.pendingSendMessage.length === 1);
    fake.pendingSendMessage.shift().resolve(idleState());

    fake.setActiveTab(2);
    fake.listeners.activated();
    await flushUntil(() => fake.pendingSendMessage.length === 1);
    fake.pendingSendMessage
      .shift()
      .resolve(failedState("Tab B", ErrorKind.TIMEOUT, ""));
    await flushUntil(() => doc.elements.title.textContent === "Tab B");

    assert.equal(doc.elements.title.textContent, "Tab B");
    assert.equal(
      doc.elements.status.textContent,
      messageFor(ErrorKind.TIMEOUT, ""),
    );
  } finally {
    cleanup();
  }
});

test("a newer live stateChanged is not overwritten by an older snapshot resolving late", async () => {
  const fake = makeFakeChrome(1);
  const doc = makeFakeDocument();
  try {
    await loadPanel(fake.chrome, doc);
    await flushUntil(() => fake.pendingSendMessage.length === 1);
    const oldSnapshot = fake.pendingSendMessage.shift();

    // The live update arrives — and is rendered — before the snapshot this
    // same binding started with ever resolves.
    fake.listeners.message({
      type: MessageType.STATE_CHANGED,
      tabId: 1,
      state: succeededState("T", "Newer summary"),
    });
    assert.equal(doc.elements.summary.textContent, "Newer summary");

    // The old snapshot resolves now, with a state from before that update.
    oldSnapshot.resolve(runningState("T"));
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(doc.elements.summary.textContent, "Newer summary");
    assert.notEqual(
      doc.elements.status.textContent,
      "Summarizing… this can take a while.",
    );
  } finally {
    cleanup();
  }
});

test("a stale snapshot for the previous tab does not overwrite the new tab's view after a rebind", async () => {
  const fake = makeFakeChrome(1);
  const doc = makeFakeDocument();
  try {
    await loadPanel(fake.chrome, doc);
    await flushUntil(() => fake.pendingSendMessage.length === 1);
    const oldTabSnapshot = fake.pendingSendMessage.shift();

    fake.setActiveTab(2);
    fake.listeners.activated();
    await flushUntil(() => fake.pendingSendMessage.length === 1);
    const newTabSnapshot = fake.pendingSendMessage.shift();

    // The old tab's snapshot resolves only now, well after the rebind.
    oldTabSnapshot.resolve(succeededState("Old tab", "Old tab summary"));
    await Promise.resolve();
    await Promise.resolve();

    assert.notEqual(doc.elements.summary.textContent, "Old tab summary");

    newTabSnapshot.resolve(idleState());
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(doc.elements.summary.textContent, "");
    assert.equal(
      doc.elements.status.textContent,
      "No summary has been run for this tab yet.",
    );
  } finally {
    cleanup();
  }
});

// §15.1 of the requirements this fixes: two active-tab lookups overlap — one
// started following a switch to B, the next started following a switch to
// C before B's lookup resolved — and are made to complete in reverse order.
// The panel must end up following C regardless: B's lookup belongs to an
// earlier followActiveTab() call than the one already in flight when it
// finally resolves, so it must never rebind the panel at all.
test("a stale active-tab lookup completing after a newer one does not revert the panel to the older tab", async () => {
  const fake = makeFakeChrome(1);
  const doc = makeFakeDocument();
  try {
    await loadPanel(fake.chrome, doc);
    await flushUntil(() => fake.pendingSendMessage.length === 1);
    fake.pendingSendMessage
      .shift()
      .resolve(succeededState("Tab A title", "Tab A summary"));
    await flushUntil(() => doc.elements.summary.textContent !== "");

    fake.setHoldTabsQuery(true);

    // Switch to B: its active-tab lookup starts and is held open.
    fake.listeners.activated();
    await flushUntil(() => fake.pendingTabsQuery.length === 1);
    const bLookup = fake.pendingTabsQuery.shift();

    // Switch to C before B's lookup has resolved: its own lookup starts too.
    fake.listeners.activated();
    await flushUntil(() => fake.pendingTabsQuery.length === 1);
    const cLookup = fake.pendingTabsQuery.shift();

    // C's lookup — the newer one — resolves first, and its snapshot request
    // is answered.
    cLookup.resolve([{ id: 3 }]);
    await flushUntil(() => fake.pendingSendMessage.length === 1);
    fake.pendingSendMessage
      .shift()
      .resolve(succeededState("Tab C title", "Tab C summary"));
    await flushUntil(() => doc.elements.summary.textContent === "Tab C summary");

    // B's lookup — the older one — resolves only now, well after C is
    // already being followed.
    bLookup.resolve([{ id: 2 }]);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // The stale B completion must never have started a rebind: no further
    // getState request went out, and C's already-rendered state stands.
    assert.equal(fake.pendingSendMessage.length, 0);
    assert.equal(doc.elements.title.textContent, "Tab C title");
    assert.equal(doc.elements.summary.textContent, "Tab C summary");
  } finally {
    cleanup();
  }
});

test("a getState failure is shown as internal-error, not idle, and is not an unhandled rejection", async () => {
  const fake = makeFakeChrome(1);
  const doc = makeFakeDocument();
  const unhandled = [];
  const onUnhandledRejection = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandledRejection);
  try {
    await loadPanel(fake.chrome, doc);
    await flushUntil(() => fake.pendingSendMessage.length === 1);
    fake.pendingSendMessage.shift().reject(new Error("message port closed"));

    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(
      doc.elements.status.textContent,
      messageFor(ErrorKind.INTERNAL_ERROR, ""),
    );
    assert.notEqual(
      doc.elements.status.textContent,
      "No summary has been run for this tab yet.",
    );
    assert.equal(doc.elements["open-settings"].hidden, true);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandledRejection);
    cleanup();
  }
});

test("an active tab query failure is shown as internal-error and is not an unhandled rejection", async () => {
  const fake = makeFakeChrome(1);
  const doc = makeFakeDocument();
  const unhandled = [];
  const onUnhandledRejection = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandledRejection);
  try {
    fake.chrome.tabs._queryImpl = () => Promise.reject(new Error("boom"));
    await loadPanel(fake.chrome, doc);

    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(
      doc.elements.status.textContent,
      messageFor(ErrorKind.INTERNAL_ERROR, ""),
    );
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandledRejection);
    cleanup();
  }
});

test("an openOptionsPage failure is caught and does not change the displayed RunState", async () => {
  const fake = makeFakeChrome(1);
  const doc = makeFakeDocument();
  const unhandled = [];
  const onUnhandledRejection = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandledRejection);
  try {
    await loadPanel(fake.chrome, doc);
    await flushUntil(() => fake.pendingSendMessage.length === 1);
    fake.pendingSendMessage
      .shift()
      .resolve(succeededState("Kept title", "Kept summary"));
    await flushUntil(() => doc.elements.title.textContent === "Kept title");

    fake.chrome.runtime._openOptionsImpl = () =>
      Promise.reject(new Error("cannot open options"));
    doc.elements.settings._listeners.click();

    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(
      doc.elements.status.textContent,
      messageFor(ErrorKind.INTERNAL_ERROR, ""),
    );
    assert.equal(doc.elements.title.textContent, "Kept title");
    assert.equal(doc.elements.summary.textContent, "Kept summary");
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandledRejection);
    cleanup();
  }
});

test("the Settings header control stays available across every phase", async () => {
  const fake = makeFakeChrome(1);
  const doc = makeFakeDocument();
  try {
    await loadPanel(fake.chrome, doc);
    for (const state of [
      idleState(),
      runningState("T"),
      succeededState("T", "S"),
      failedState("T", ErrorKind.TIMEOUT, ""),
    ]) {
      fake.listeners.message({
        type: MessageType.STATE_CHANGED,
        tabId: 1,
        state,
      });
      assert.equal(doc.elements.settings.hidden, false);
    }
  } finally {
    cleanup();
  }
});

test("Open settings is offered only for credential-missing and permission-missing", async () => {
  const fake = makeFakeChrome(1);
  const doc = makeFakeDocument();
  try {
    await loadPanel(fake.chrome, doc);
    for (const kind of Object.values(ErrorKind)) {
      fake.listeners.message({
        type: MessageType.STATE_CHANGED,
        tabId: 1,
        state: failedState("T", kind, ""),
      });
      const expected =
        kind === ErrorKind.CREDENTIAL_MISSING ||
        kind === ErrorKind.PERMISSION_MISSING;
      assert.equal(
        doc.elements["open-settings"].hidden,
        !expected,
        `unexpected Open settings visibility for ${kind}`,
      );
    }
  } finally {
    cleanup();
  }
});
