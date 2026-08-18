import test from "node:test";
import assert from "node:assert/strict";

// The listeners are registered at import time, so a fake chrome is installed
// before a fresh instance of the module is loaded.
async function loadWorkerWithFakeChrome() {
  const listeners = {};
  const removedKeys = [];
  const chrome = {
    action: { onClicked: { addListener: (fn) => (listeners.clicked = fn) } },
    runtime: {
      getURL: (path) => path,
      onInstalled: { addListener: () => {} },
      onMessage: { addListener: (fn) => (listeners.message = fn) },
      sendMessage: () => Promise.resolve(),
    },
    sidePanel: {
      setOptions: () => {},
      open: () => {},
      setPanelBehavior: () => Promise.resolve(),
    },
    storage: {
      session: {
        get: () => Promise.resolve({}),
        set: () => Promise.resolve(),
        remove: (key) => {
          removedKeys.push(key);
          return Promise.resolve();
        },
      },
    },
    tabs: {
      onRemoved: { addListener: (fn) => (listeners.removed = fn) },
      onUpdated: { addListener: (fn) => (listeners.updated = fn) },
    },
  };

  globalThis.chrome = chrome;
  const worker = await import(
    `../src/background/service_worker.js?tab-removed-${Math.random()}`
  );
  return { worker, chrome, listeners, removedKeys };
}

test("closing a tab invalidates its work before the state is removed", async () => {
  const { worker, chrome, listeners, removedKeys } =
    await loadWorkerWithFakeChrome();
  try {
    assert.equal(typeof listeners.removed, "function");

    assert.equal(worker.claimRun(41), true);
    const run = worker.currentRun(41);

    // The state may only be removed once the run can no longer write it back.
    const validityAtRemoval = [];
    chrome.storage.session.remove = (key) => {
      validityAtRemoval.push(worker.isCurrentRun(41, run));
      removedKeys.push(key);
      return Promise.resolve();
    };

    listeners.removed(41);

    assert.deepEqual(removedKeys, ["run:41"]);
    assert.deepEqual(validityAtRemoval, [false]);
    assert.equal(worker.isCurrentRun(41, run), false);
  } finally {
    delete globalThis.chrome;
  }
});

test("a late engine answer writes nothing for a closed tab", async () => {
  const { worker, listeners } = await loadWorkerWithFakeChrome();
  try {
    assert.equal(worker.claimRun(42), true);
    const run = worker.currentRun(42);

    listeners.removed(42);

    let calls = 0;
    const answer = await worker.summarizeMaterial(
      { title: "T", text: "A normal page.", charCount: 14 },
      "Summarize it.",
      async () => {
        calls += 1;
        return { ok: true, summary: "Late." };
      },
      0,
      () => worker.isCurrentRun(42, run),
    );

    assert.equal(calls, 0);
    assert.equal(answer, null);
  } finally {
    delete globalThis.chrome;
  }
});
