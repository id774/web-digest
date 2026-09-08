import test from "node:test";
import assert from "node:assert/strict";

// The listeners are registered at import time, so a fake chrome is installed
// before a fresh instance of the module is loaded.
async function loadWorkerWithFakeChrome() {
  const listeners = {};
  const removedKeys = [];
  const setKeys = [];
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
        set: (fields) => {
          setKeys.push(...Object.keys(fields));
          return Promise.resolve();
        },
        remove: (key) => {
          removedKeys.push(key);
          return Promise.resolve();
        },
      },
    },
    tabs: {
      onRemoved: { addListener: (fn) => (listeners.removed = fn) },
      onUpdated: { addListener: (fn) => (listeners.updated = fn) },
      onReplaced: { addListener: (fn) => (listeners.replaced = fn) },
    },
  };

  globalThis.chrome = chrome;
  const worker = await import(
    `../src/background/service_worker.js?tab-replaced-${Math.random()}`
  );
  return { worker, chrome, listeners, removedKeys, setKeys };
}

test("replacing a tab invalidates its work before the removed state is discarded", async () => {
  const { worker, chrome, listeners, removedKeys, setKeys } =
    await loadWorkerWithFakeChrome();
  try {
    assert.equal(typeof listeners.replaced, "function");

    assert.equal(worker.claimRun(41), true);
    const run = worker.currentRun(41);

    // The state may only be removed once the run can no longer write it back.
    const validityAtRemoval = [];
    chrome.storage.session.remove = (key) => {
      validityAtRemoval.push(worker.isCurrentRun(41, run));
      removedKeys.push(key);
      return Promise.resolve();
    };

    listeners.replaced(87, 41);
    await worker.waitForDiscard(41);

    assert.deepEqual(removedKeys, ["run:41"]);
    assert.deepEqual(validityAtRemoval, [false]);
    assert.equal(worker.isCurrentRun(41, run), false);
    assert.equal(worker.currentRun(87), undefined);
    assert.ok(
      !setKeys.includes("run:87"),
      "the added tab identity must never receive a state write",
    );
  } finally {
    delete globalThis.chrome;
  }
});

test("a late engine answer writes nothing for a replaced tab", async () => {
  const { worker, listeners } = await loadWorkerWithFakeChrome();
  try {
    assert.equal(worker.claimRun(42), true);
    const run = worker.currentRun(42);

    listeners.replaced(88, 42);

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
    assert.equal(worker.isCurrentRun(42, run), false);
    assert.equal(worker.currentRun(88), undefined);
  } finally {
    delete globalThis.chrome;
  }
});
