import test from "node:test";
import assert from "node:assert/strict";

// These tests reproduce the exact orderings described for the per-tab
// RunState cleanup races: a chrome.storage.session write already in flight
// when navigation or a tab close begins its cleanup, and a cleanup racing
// against the next run's own first write. Both `set` and `remove` on the
// fake session store are independently controllable, so the *call order*
// between a run's write and a cleanup's remove — not just their eventual
// effect on the store — can be asserted deterministically. The listeners
// are registered at import time, so a fresh fake chrome is installed before
// each fresh instance of the module is loaded.

function makeFakeChrome() {
  const listeners = {};
  const store = new Map();
  const calls = [];
  const pendingSets = [];
  const pendingRemoves = [];

  const chrome = {
    action: { onClicked: { addListener: (fn) => (listeners.clicked = fn) } },
    runtime: {
      getURL: (path) => path,
      onInstalled: { addListener: () => {} },
      onMessage: { addListener: (fn) => (listeners.message = fn) },
      sendMessage: () => Promise.resolve(),
    },
    sidePanel: {
      setOptions: async () => {},
      open: async () => {},
      setPanelBehavior: async () => {},
    },
    storage: {
      session: {
        get: async (key) => ({ [key]: store.get(key) }),
        set: (fields) => {
          const [key, value] = Object.entries(fields)[0];
          calls.push(["set-called", key]);
          return new Promise((resolve) => {
            pendingSets.push(() => {
              store.set(key, value);
              calls.push(["set-applied", key]);
              resolve();
            });
          });
        },
        remove: (key) => {
          calls.push(["remove-called", key]);
          return new Promise((resolve) => {
            pendingRemoves.push(() => {
              store.delete(key);
              calls.push(["remove-applied", key]);
              resolve();
            });
          });
        },
      },
      // Never resolves: a run that has written its `running` state stalls
      // here, which is all these tests need — the race under test is over
      // by the time settings would have been read.
      local: { get: () => new Promise(() => {}) },
    },
    tabs: {
      onRemoved: { addListener: (fn) => (listeners.removed = fn) },
      onUpdated: { addListener: (fn) => (listeners.updated = fn) },
    },
  };

  return { chrome, listeners, store, calls, pendingSets, pendingRemoves };
}

async function loadWorker(chrome) {
  globalThis.chrome = chrome;
  return await import(
    `../src/background/service_worker.js?run-state-race-${Math.random()}`
  );
}

async function flushUntil(predicate, maxTicks = 200) {
  for (let i = 0; i < maxTicks && !predicate(); i++) {
    await Promise.resolve();
  }
}

test("navigation cleanup's remove is not issued until an in-flight write for the same tab has resolved", async () => {
  const { chrome, listeners, store, calls, pendingSets, pendingRemoves } =
    makeFakeChrome();
  try {
    const worker = await loadWorker(chrome);

    listeners.clicked({ id: 51, title: "Old page" });
    await flushUntil(() => pendingSets.length === 1);
    assert.deepEqual(calls, [["set-called", "run:51"]]);

    // Navigation starts while that write is still unresolved.
    listeners.updated(51, { status: "loading" });

    // Give a buggy, un-queued cleanup every chance to call remove() early.
    await flushUntil(() => calls.length > 1, 50);
    assert.deepEqual(
      calls,
      [["set-called", "run:51"]],
      "remove must stay queued behind the still-pending write",
    );

    const cleanupSettled = worker.waitForDiscard(51);

    // Only now does the old write actually complete.
    pendingSets.shift()();
    await flushUntil(() => pendingRemoves.length === 1);
    assert.deepEqual(calls, [
      ["set-called", "run:51"],
      ["set-applied", "run:51"],
      ["remove-called", "run:51"],
    ]);

    pendingRemoves.shift()();
    await cleanupSettled;

    assert.equal(store.has("run:51"), false);
  } finally {
    delete globalThis.chrome;
  }
});

test("a tab-close cleanup's remove is not issued until an in-flight write for the same tab has resolved", async () => {
  const { chrome, listeners, store, calls, pendingSets, pendingRemoves } =
    makeFakeChrome();
  try {
    const worker = await loadWorker(chrome);

    listeners.clicked({ id: 52, title: "Old page" });
    await flushUntil(() => pendingSets.length === 1);
    assert.deepEqual(calls, [["set-called", "run:52"]]);

    // The tab closes while that write is still unresolved.
    listeners.removed(52);

    await flushUntil(() => calls.length > 1, 50);
    assert.deepEqual(
      calls,
      [["set-called", "run:52"]],
      "remove must stay queued behind the still-pending write",
    );

    const cleanupSettled = worker.waitForDiscard(52);

    pendingSets.shift()();
    await flushUntil(() => pendingRemoves.length === 1);
    assert.deepEqual(calls, [
      ["set-called", "run:52"],
      ["set-applied", "run:52"],
      ["remove-called", "run:52"],
    ]);

    pendingRemoves.shift()();
    await cleanupSettled;

    assert.equal(store.has("run:52"), false);
  } finally {
    delete globalThis.chrome;
  }
});

test("an old navigation cleanup does not delete the state of the run that started after it", async () => {
  const { chrome, listeners, store, calls, pendingSets, pendingRemoves } =
    makeFakeChrome();
  try {
    const worker = await loadWorker(chrome);

    // The first run's write begins and is left pending.
    listeners.clicked({ id: 53, title: "Old page" });
    await flushUntil(() => pendingSets.length === 1);
    assert.deepEqual(calls, [["set-called", "run:53"]]);

    // Navigation invalidates the first run and asks for its cleanup.
    listeners.updated(53, { status: "loading" });

    // Before the old write or its cleanup has settled, the reader clicks
    // again: the new run claims the tab and queues its own first write.
    listeners.clicked({ id: 53, title: "New page" });

    // Give everything queued so far a generous chance to run out of order.
    await flushUntil(() => calls.length > 1, 50);
    assert.deepEqual(
      calls,
      [["set-called", "run:53"]],
      "neither the cleanup's remove nor the new run's write may be issued yet",
    );

    // The old write completes.
    pendingSets.shift()();
    await flushUntil(() => pendingRemoves.length === 1);
    assert.deepEqual(calls, [
      ["set-called", "run:53"],
      ["set-applied", "run:53"],
      ["remove-called", "run:53"],
    ]);

    // The old cleanup completes.
    pendingRemoves.shift()();
    await flushUntil(() => pendingSets.length === 1);

    // Only now does the new run's own first write go out.
    assert.deepEqual(calls, [
      ["set-called", "run:53"],
      ["set-applied", "run:53"],
      ["remove-called", "run:53"],
      ["remove-applied", "run:53"],
      ["set-called", "run:53"],
    ]);

    pendingSets.shift()();
    await worker.waitForDiscard(53);

    const stored = store.get("run:53");
    assert.equal(stored.phase, "running");
    assert.equal(stored.title, "New page");
  } finally {
    delete globalThis.chrome;
  }
});
