import test from "node:test";
import assert from "node:assert/strict";

import { ErrorKind } from "../src/common/errors.js";
import { MessageType } from "../src/common/messages.js";

// These tests reproduce the storage.session read/write/remove failure
// scenarios the worker must contain: a read failure must answer getState
// with a bounded internal-error RunState rather than an unhandled
// rejection; a write failure must not be mistaken for success and must not
// recurse into the same failing helper, nor permanently block later writes
// for the same tab; a cleanup remove failure must not swallow the idle
// notification with it, and its one fallback write must not be retried.
// The listeners are registered at import time, so a fresh fake chrome is
// installed before each fresh instance of the module is loaded.

function makeFakeChrome() {
  const listeners = {};
  const store = new Map();
  const calls = [];
  const pendingSets = [];

  const chrome = {
    action: { onClicked: { addListener: (fn) => (listeners.clicked = fn) } },
    runtime: {
      getURL: (path) => path,
      onInstalled: { addListener: () => {} },
      onMessage: { addListener: (fn) => (listeners.message = fn) },
      sendMessage: (message) => {
        calls.push(["sendMessage", message]);
        return Promise.resolve();
      },
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
          calls.push(["set-called", fields]);
          return new Promise((resolve, reject) => {
            pendingSets.push({
              resolve: () => {
                for (const [key, value] of Object.entries(fields)) {
                  store.set(key, value);
                }
                calls.push(["set-applied", fields]);
                resolve();
              },
              reject: (error) => {
                calls.push(["set-rejected", fields]);
                reject(error);
              },
            });
          });
        },
        remove: (key) => {
          calls.push(["remove-called", key]);
          store.delete(key);
          return Promise.resolve();
        },
      },
      // Never resolves: a run that has written its `running` state stalls
      // here, which is enough for the tests below — they only care about
      // whether that read was even attempted, not about a full run.
      local: { get: () => new Promise(() => {}) },
    },
    tabs: {
      onRemoved: { addListener: (fn) => (listeners.removed = fn) },
      onUpdated: { addListener: (fn) => (listeners.updated = fn) },
    },
  };

  return { chrome, listeners, store, calls, pendingSets };
}

async function loadWorker(chrome) {
  globalThis.chrome = chrome;
  return await import(
    `../src/background/service_worker.js?state-failures-${Math.random()}`
  );
}

async function flushUntil(predicate, maxTicks = 200) {
  for (let i = 0; i < maxTicks && !predicate(); i++) {
    await Promise.resolve();
  }
  assert.ok(predicate(), "condition was not met within the tick budget");
}

test("a storage.session read failure answers getState with a bounded internal-error state, not a rejection", async () => {
  const { chrome, listeners } = makeFakeChrome();
  try {
    chrome.storage.session.get = async () => {
      throw new Error("storage unavailable");
    };
    await loadWorker(chrome);

    let response;
    const handled = listeners.message(
      { type: MessageType.GET_STATE, tabId: 77 },
      {},
      (value) => {
        response = value;
      },
    );
    assert.equal(handled, true);
    await flushUntil(() => response !== undefined);

    assert.deepEqual(response, {
      phase: "failed",
      title: "",
      summary: "",
      errorKind: ErrorKind.INTERNAL_ERROR,
      errorDetail: "",
    });
  } finally {
    delete globalThis.chrome;
  }
});

test("fail() never throws even when the write it attempts also fails, and broadcasts the state directly", async () => {
  const { chrome, calls } = makeFakeChrome();
  try {
    const worker = await loadWorker(chrome);
    chrome.storage.session.set = () =>
      Promise.reject(new Error("storage unavailable"));

    assert.equal(worker.claimRun(51), true);
    const run = worker.currentRun(51);

    await assert.doesNotReject(
      worker.fail(51, run, "A title", Date.now(), ErrorKind.INTERNAL_ERROR),
    );

    const broadcasts = calls.filter(
      ([kind, message]) =>
        kind === "sendMessage" && message.type === MessageType.STATE_CHANGED,
    );
    assert.equal(broadcasts.length, 1);
    assert.deepEqual(broadcasts[0][1].state, {
      phase: "failed",
      title: "A title",
      summary: "",
      errorKind: ErrorKind.INTERNAL_ERROR,
      errorDetail: "",
    });
  } finally {
    delete globalThis.chrome;
  }
});

test("fail() writes the failed state to storage normally when the write succeeds", async () => {
  const { chrome, store } = makeFakeChrome();
  try {
    const worker = await loadWorker(chrome);
    chrome.storage.session.set = (fields) => {
      for (const [key, value] of Object.entries(fields)) store.set(key, value);
      return Promise.resolve();
    };

    assert.equal(worker.claimRun(52), true);
    const run = worker.currentRun(52);

    await worker.fail(52, run, "A title", Date.now(), ErrorKind.TIMEOUT);

    assert.deepEqual(store.get("run:52"), {
      phase: "failed",
      title: "A title",
      summary: "",
      errorKind: ErrorKind.TIMEOUT,
      errorDetail: "",
    });
  } finally {
    delete globalThis.chrome;
  }
});

test("an initial running-state write failure stops the run before settings, extraction or a provider call, with no unhandled rejection", async () => {
  const { chrome, listeners } = makeFakeChrome();
  const unhandled = [];
  const onUnhandledRejection = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandledRejection);
  try {
    await loadWorker(chrome);
    chrome.storage.session.set = () =>
      Promise.reject(new Error("storage unavailable"));
    let localGetCalls = 0;
    chrome.storage.local.get = () => {
      localGetCalls += 1;
      return new Promise(() => {});
    };

    listeners.clicked({ id: 61, title: "A page" });

    // Give the run every chance to reach settings if it were going to.
    for (let i = 0; i < 50; i++) await Promise.resolve();
    // Node only reports a rejection as unhandled after giving this turn a
    // chance to attach a .catch — a macrotask, not just a microtask drain.
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(localGetCalls, 0, "readSettings must never be reached");
    assert.deepEqual(unhandled, [], "expected no unhandled promise rejection");
  } finally {
    process.off("unhandledRejection", onUnhandledRejection);
    delete globalThis.chrome;
  }
});

test("a write failure does not permanently block later state writes for the same tab", async () => {
  const { chrome, listeners, store } = makeFakeChrome();
  try {
    await loadWorker(chrome);

    let rejectFirstSet = true;
    chrome.storage.session.set = (fields) => {
      if (rejectFirstSet) {
        rejectFirstSet = false;
        return Promise.reject(new Error("storage unavailable"));
      }
      for (const [key, value] of Object.entries(fields)) store.set(key, value);
      return Promise.resolve();
    };
    // Stalls readSettings for whichever run reaches it, same as above.
    chrome.storage.local.get = () => new Promise(() => {});

    listeners.clicked({ id: 62, title: "First" });
    for (let i = 0; i < 50; i++) await Promise.resolve();

    listeners.clicked({ id: 62, title: "Second" });
    for (let i = 0; i < 50; i++) await Promise.resolve();

    const stored = store.get("run:62");
    assert.ok(stored, "the second run's write should have landed");
    assert.equal(stored.phase, "running");
    assert.equal(stored.title, "Second");
  } finally {
    delete globalThis.chrome;
  }
});

test("a cleanup remove failure falls back to one idle-state write and still broadcasts idle, without retrying the remove", async () => {
  const { chrome, listeners, store, calls, pendingSets } = makeFakeChrome();
  try {
    store.set("run:63", {
      phase: "succeeded",
      title: "T",
      summary: "S",
      errorKind: "",
      errorDetail: "",
    });

    chrome.storage.session.remove = (key) => {
      calls.push(["remove-called", key]);
      return Promise.reject(new Error("storage unavailable"));
    };

    await loadWorker(chrome);

    listeners.updated(63, { status: "loading" });

    await flushUntil(() => pendingSets.length === 1);
    pendingSets.shift().resolve();

    await flushUntil(() =>
      calls.some(
        ([kind, message]) =>
          kind === "sendMessage" &&
          message.type === MessageType.STATE_CHANGED &&
          message.state.phase === "idle",
      ),
    );

    const removeCalls = calls.filter(([kind]) => kind === "remove-called");
    assert.equal(removeCalls.length, 1, "remove must not be retried");

    const setCalls = calls.filter(([kind]) => kind === "set-called");
    assert.equal(setCalls.length, 1, "exactly one fallback write");
    assert.deepEqual(setCalls[0][1], {
      "run:63": {
        phase: "idle",
        title: "",
        summary: "",
        errorKind: "",
        errorDetail: "",
      },
    });

    assert.equal(store.get("run:63").phase, "idle");
  } finally {
    delete globalThis.chrome;
  }
});
