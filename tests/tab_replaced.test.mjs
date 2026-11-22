import test from "node:test";
import assert from "node:assert/strict";

// The listeners are registered at import time, so a fake chrome is installed
// before a fresh instance of the module is loaded.
async function loadWorkerWithFakeChrome() {
  const listeners = {};
  const removedKeys = [];
  const session = new Map();
  const setKeys = [];
  const chrome = {
    action: { onClicked: { addListener: (fn) => (listeners.clicked = fn) } },
    runtime: {
      getURL: (path) => path,
      getPlatformInfo: () => Promise.resolve({}),
      onInstalled: { addListener: () => {} },
      onMessage: { addListener: (fn) => (listeners.message = fn) },
      sendMessage: () => Promise.resolve(),
    },
    sidePanel: {
      setOptions: () => {},
      open: () => {},
      setPanelBehavior: () => Promise.resolve(),
    },
    scripting: {
      executeScript: async () => [{ result: {
        title: "Synthetic page",
        blocks: [{ kind: "paragraph", text: "Synthetic content. ".repeat(30) }],
      } }],
    },
    storage: {
      local: { get: async () => ({
        provider: "sakura",
        apiToken: "synthetic-test-token",
        diagnosticLogging: true,
      }) },
      session: {
        get: (key) => Promise.resolve({ [key]: session.get(key) }),
        set: (fields) => {
          setKeys.push(...Object.keys(fields));
          for (const [key, value] of Object.entries(fields)) session.set(key, value);
          return Promise.resolve();
        },
        remove: (key) => {
          removedKeys.push(key);
          session.delete(key);
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

test("A03: replacing aborts only the removed tab's pending request", async (t) => {
  const { worker, listeners, removedKeys } = await loadWorkerWithFakeChrome();
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (url === "prompts/summarize.md") {
      return { ok: true, text: async () => "Summarize synthetic material." };
    }
    return new Promise((resolve) => { requests.push({ signal: init.signal, resolve }); });
  });
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "error", () => {});
  try {
    for (const id of [41, 87, 99]) listeners.clicked({ id, title: "Synthetic tab" });
    for (let i = 0; i < 800 && requests.length < 3; i++) await Promise.resolve();
    assert.equal(requests.length, 3);
    const oldRun = worker.currentRun(41);
    const cleanupStart = removedKeys.length;
    listeners.replaced(87, 41);
    assert.equal(worker.isCurrentRun(41, oldRun), false);
    assert.equal(requests[0].signal.aborted, true);
    assert.equal(requests[1].signal.aborted, false);
    assert.equal(requests[2].signal.aborted, false);
    await worker.waitForDiscard(41);
    for (let i = 0; i < 100; i++) await Promise.resolve();
    assert.deepEqual(removedKeys.slice(cleanupStart).sort(), ["diag:41", "run:41"]);
    assert.ok(worker.currentRun(87));
    assert.ok(worker.currentRun(99));

    listeners.clicked({ id: 41, title: "New synthetic tab" });
    for (let i = 0; i < 800 && requests.length < 4; i++) await Promise.resolve();
    assert.equal(requests.length, 4);
    assert.notEqual(worker.currentRun(41), oldRun);
    assert.notEqual(requests[3].signal, requests[0].signal);
    assert.equal(requests[3].signal.aborted, false);
  } finally {
    for (const request of requests) {
      request.resolve({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ finish_reason: "stop", message: { content: "Synthetic summary." } }] }),
      });
    }
    for (let i = 0; i < 800; i++) await Promise.resolve();
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
