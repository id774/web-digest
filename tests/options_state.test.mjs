import test from "node:test";
import assert from "node:assert/strict";

import {
  STORAGE_KEY_JAPANESE_SUMMARY,
  STORAGE_KEY_OPENAI_KEY,
  STORAGE_KEY_PROVIDER,
  STORAGE_KEY_TOKEN,
} from "../src/common/settings.js";

// A hand-rolled DOM stub: only what options.js touches on the elements it
// looks up by id — value, textContent, checked, hidden, disabled,
// placeholder — plus addEventListener, captured so a test can invoke a
// handler directly instead of driving a real event loop.

const ELEMENT_IDS = [
  "provider",
  "provider-status",
  "grant-permission",
  "credential",
  "credential-label",
  "credential-status",
  "model",
  "save",
  "delete",
  "status",
  "japanese-summary",
  "japanese-summary-status",
];

function makeElement() {
  return {
    value: "",
    textContent: "",
    checked: false,
    hidden: false,
    disabled: false,
    placeholder: "",
    _listeners: {},
    addEventListener(type, handler) {
      this._listeners[type] = handler;
    },
  };
}

function makeFakeDocument() {
  const elements = {};
  for (const id of ELEMENT_IDS) elements[id] = makeElement();
  return {
    elements,
    getElementById: (id) => elements[id],
  };
}

async function fire(element, type) {
  const handler = element._listeners[type];
  assert.ok(handler, `expected a "${type}" listener`);
  await handler();
}

// chrome.storage.local.get resolves immediately from the seeded store for
// most tests — the races they cover are all about set/remove/request, never
// about reads. The initial-load race tests (§15.2/§15.3 of the requirements
// this fixes) are the exception: `holdGets: true` makes every get() instead
// return a promise pushed onto `pendingGets`, settled by hand, so a test can
// hold the options page's own initial reads open and attempt a user action
// while they are still unresolved. Each set/remove/request likewise returns
// a promise this test settles by hand, via the entry pushed onto its queue,
// so the exact interleaving a race needs can be constructed deterministically.
function makeFakeChrome(seed = {}, { holdGets = false } = {}) {
  const store = new Map(Object.entries(seed));
  const calls = [];
  const pendingGets = [];
  const pendingSets = [];
  const pendingRemoves = [];
  const pendingPermissionRequests = [];

  function readResult(keys) {
    const keyList = Array.isArray(keys) ? keys : [keys];
    const result = {};
    for (const key of keyList) {
      if (store.has(key)) result[key] = store.get(key);
    }
    return result;
  }

  const chrome = {
    storage: {
      local: {
        get: (keys) => {
          calls.push(["get-called", keys]);
          if (!holdGets) return Promise.resolve(readResult(keys));
          return new Promise((resolve) => {
            pendingGets.push({ keys, resolve: () => resolve(readResult(keys)) });
          });
        },
        set: (fields) => {
          calls.push(["set-called", fields]);
          return new Promise((resolve, reject) => {
            pendingSets.push({
              fields,
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
          return new Promise((resolve, reject) => {
            pendingRemoves.push({
              key,
              resolve: () => {
                store.delete(key);
                calls.push(["remove-applied", key]);
                resolve();
              },
              reject: (error) => {
                calls.push(["remove-rejected", key]);
                reject(error);
              },
            });
          });
        },
      },
    },
    permissions: {
      request: (query) => {
        calls.push(["permission-request", query]);
        return new Promise((resolve, reject) => {
          pendingPermissionRequests.push({ query, resolve, reject });
        });
      },
    },
  };

  return {
    chrome,
    store,
    calls,
    pendingGets,
    pendingSets,
    pendingRemoves,
    pendingPermissionRequests,
  };
}

async function flushUntil(predicate, maxTicks = 200) {
  for (let i = 0; i < maxTicks && !predicate(); i++) {
    await Promise.resolve();
  }
  assert.ok(predicate(), "condition was not met within the tick budget");
}

async function loadOptionsPage(chrome) {
  const fakeDocument = makeFakeDocument();
  globalThis.chrome = chrome;
  globalThis.document = fakeDocument;
  await import(`../src/options/options.js?options-state-${Math.random()}`);
  // load() runs unawaited from wire(); every read it uses resolves on its
  // own microtask. The provider control is re-enabled only once every read
  // — provider, model, credential status and the Japanese summary
  // preference — has landed, so draining until it is no longer disabled is
  // what actually knows the initializing phase (§7.3) is over, rather than
  // just that the first of those reads has resolved.
  await flushUntil(() => fakeDocument.elements.provider.disabled === false);
  return fakeDocument.elements;
}

function cleanup() {
  delete globalThis.chrome;
  delete globalThis.document;
}

// For the initial-load race tests below: returns as soon as the module is
// wired, without waiting for load() — which, with `holdGets: true`, never
// resolves on its own until the test releases its held get() calls.
async function loadOptionsPageWithoutWaiting(chrome) {
  const fakeDocument = makeFakeDocument();
  globalThis.chrome = chrome;
  globalThis.document = fakeDocument;
  await import(`../src/options/options.js?options-init-race-${Math.random()}`);
  return fakeDocument.elements;
}

async function resolveNextGet(pendingGets) {
  await flushUntil(() => pendingGets.length >= 1);
  pendingGets.shift().resolve();
}

test("a second provider change started while one is in flight is ignored, not raced", async () => {
  const { chrome, calls, pendingPermissionRequests, pendingSets } =
    makeFakeChrome();
  try {
    const els = await loadOptionsPage(chrome);
    assert.equal(els.provider.value, "sakura");

    els.provider.value = "openai";
    const firstChange = fire(els.provider, "change");
    await flushUntil(() => pendingPermissionRequests.length === 1);

    // The select is disabled for the duration, but a test can still race the
    // handler directly — that must be a no-op, not a second transaction.
    assert.equal(els.provider.disabled, true);
    els.provider.value = "anthropic";
    await fire(els.provider, "change");

    // Ignored: no second permission request went out, and the control was
    // put back to the provider this page still has confirmed.
    assert.equal(pendingPermissionRequests.length, 1);
    assert.equal(els.provider.value, "sakura");

    pendingPermissionRequests.shift().resolve(true);
    await flushUntil(() => pendingSets.length === 1);
    pendingSets.shift().resolve();
    await firstChange;

    assert.equal(els.provider.value, "openai");
    assert.equal(els["provider-status"].textContent, "Now using OpenAI.");
    assert.equal(els.provider.disabled, false);
    assert.equal(
      calls.filter(([kind]) => kind === "permission-request").length,
      1,
    );
  } finally {
    cleanup();
  }
});

test("a blocked second change never lets a stale provider load reach the DOM", async () => {
  const { chrome, pendingPermissionRequests, pendingSets } = makeFakeChrome();
  try {
    const els = await loadOptionsPage(chrome);
    const initialCredentialLabel = els["credential-label"].textContent;

    els.provider.value = "openai";
    const firstChange = fire(els.provider, "change");
    await flushUntil(() => pendingPermissionRequests.length === 1);

    // Attempting a second, conflicting change while the first is unresolved.
    els.provider.value = "anthropic";
    await fire(els.provider, "change");

    // Neither the ignored attempt's provider nor its fields ever appear:
    // the label is still whatever the confirmed (sakura) provider showed
    // before this transaction started.
    assert.equal(els["credential-label"].textContent, initialCredentialLabel);
    assert.notEqual(els["credential-label"].textContent, "OpenAI API key");
    assert.notEqual(els["credential-label"].textContent, "Claude API key");

    pendingPermissionRequests.shift().resolve(true);
    await flushUntil(() => pendingSets.length === 1);
    pendingSets.shift().resolve();
    await firstChange;

    // Only the confirmed (openai) provider's fields ever landed.
    assert.equal(els["credential-label"].textContent, "OpenAI API key");
  } finally {
    cleanup();
  }
});

test("a provider selection storage failure keeps the previous provider confirmed", async () => {
  const { chrome, pendingPermissionRequests, pendingSets } = makeFakeChrome();
  try {
    const els = await loadOptionsPage(chrome);

    els.provider.value = "openai";
    const change = fire(els.provider, "change");
    await flushUntil(() => pendingPermissionRequests.length === 1);
    pendingPermissionRequests.shift().resolve(true);

    await flushUntil(() => pendingSets.length === 1);
    pendingSets.shift().reject(new Error("storage unavailable"));
    await change;

    assert.equal(els.provider.value, "sakura");
    assert.equal(
      els["provider-status"].textContent,
      "The provider could not be saved. The provider was not changed.",
    );
    // Granted permission is not revoked by the rollback: nothing here calls
    // chrome.permissions.remove, and requesting again for openai would not
    // prompt — out of scope to assert directly without a fake `contains`,
    // but the rollback itself must not have touched credential-label.
    assert.equal(els["credential-label"].textContent, "Sakura AI Engine API token");
    assert.equal(els.provider.disabled, false);
  } finally {
    cleanup();
  }
});

test("a Save storage failure keeps the entered credential and model, and does not claim success", async () => {
  const { chrome, pendingSets } = makeFakeChrome();
  try {
    const els = await loadOptionsPage(chrome);
    assert.equal(els["credential-status"].textContent, "No credential is configured.");

    els.credential.value = "sk-test-credential";
    els.model.value = "custom-model";
    const save = fire(els.save, "click");

    await flushUntil(() => pendingSets.length === 1);
    pendingSets.shift().reject(new Error("storage unavailable"));
    await save;

    assert.equal(els.credential.value, "sk-test-credential");
    assert.equal(els.model.value, "custom-model");
    assert.equal(els["credential-status"].textContent, "No credential is configured.");
    assert.equal(els.status.textContent, "The settings could not be saved.");
  } finally {
    cleanup();
  }
});

test("a Delete credential storage failure does not report the credential as removed", async () => {
  const { chrome, pendingRemoves } = makeFakeChrome({
    [STORAGE_KEY_TOKEN]: "sk-existing",
  });
  try {
    const els = await loadOptionsPage(chrome);
    assert.equal(els["credential-status"].textContent, "A credential is configured.");

    const remove = fire(els.delete, "click");
    await flushUntil(() => pendingRemoves.length === 1);
    pendingRemoves.shift().reject(new Error("storage unavailable"));
    await remove;

    assert.equal(els["credential-status"].textContent, "A credential is configured.");
    assert.equal(els.status.textContent, "The credential could not be deleted.");
  } finally {
    cleanup();
  }
});

test("a Japanese summary storage failure reverts the checkbox to the last confirmed value", async () => {
  const { chrome, pendingSets } = makeFakeChrome();
  try {
    const els = await loadOptionsPage(chrome);
    assert.equal(els["japanese-summary"].checked, false);

    els["japanese-summary"].checked = true;
    const change = fire(els["japanese-summary"], "change");
    await flushUntil(() => pendingSets.length === 1);
    pendingSets.shift().reject(new Error("storage unavailable"));
    await change;

    assert.equal(els["japanese-summary"].checked, false);
    assert.equal(
      els["japanese-summary-status"].textContent,
      "The Japanese summary preference could not be saved.",
    );
  } finally {
    cleanup();
  }
});

test("two overlapping Japanese summary toggles are serialized, so the later one alone decides the stored value", async () => {
  const { chrome, store, pendingSets } = makeFakeChrome();
  try {
    const els = await loadOptionsPage(chrome);

    els["japanese-summary"].checked = true;
    const firstChange = fire(els["japanese-summary"], "change");
    await flushUntil(() => pendingSets.length === 1);

    // The reader toggles again before the first save has landed. A bare
    // generation check on the UI would let this second save start racing
    // the first one in storage; queuing must keep it from even being
    // issued until the first one settles.
    els["japanese-summary"].checked = false;
    const secondChange = fire(els["japanese-summary"], "change");
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(
      pendingSets.length,
      1,
      "the second save must stay queued behind the first, not race it",
    );

    pendingSets.shift().resolve();
    await firstChange;

    await flushUntil(() => pendingSets.length === 1);
    pendingSets.shift().resolve();
    await secondChange;

    assert.equal(els["japanese-summary"].checked, false);
    assert.equal(els["japanese-summary-status"].textContent, "Saved.");
    assert.equal(store.get(STORAGE_KEY_JAPANESE_SUMMARY), false);
  } finally {
    cleanup();
  }
});

// §15.2 of the requirements this fixes: the initial read of the stored
// provider is held open, and a provider change and a Save are both attempted
// while it is still unresolved — before this page has any confirmed idea
// what provider is actually stored. Neither may go through: `currentProvider`
// is still the provisional "sakura" default at that point, and a write based
// on it would land in the wrong provider's storage keys once the real,
// different stored provider ("openai") is read back.
test("a provider change and a Save attempted before the initial load resolves are refused, and the confirmed provider wins once ready", async () => {
  const { chrome, store, calls, pendingGets, pendingSets, pendingPermissionRequests } =
    makeFakeChrome({ [STORAGE_KEY_PROVIDER]: "openai" }, { holdGets: true });
  try {
    const els = await loadOptionsPageWithoutWaiting(chrome);

    // load() has started; its first read (the stored provider) is pending.
    await flushUntil(() => pendingGets.length >= 1);
    assert.equal(els.provider.disabled, true);

    els.provider.value = "anthropic";
    await fire(els.provider, "change");
    assert.equal(
      pendingPermissionRequests.length,
      0,
      "a provider change during initial load must not request a permission",
    );
    assert.equal(els.provider.value, "sakura");

    els.credential.value = "sk-during-init";
    await fire(els.save, "click");
    assert.equal(
      calls.filter(([kind]) => kind === "set-called").length,
      0,
      "Save during initial load must not write anything",
    );

    await fire(els["grant-permission"], "click");
    assert.equal(
      pendingPermissionRequests.length,
      0,
      "Grant permission during initial load must not request a permission",
    );

    // Now let the initial load's own reads settle, in the order load() and
    // loadProviderFields() issue them: provider, model, credential, then the
    // Japanese summary preference.
    await resolveNextGet(pendingGets); // provider
    await resolveNextGet(pendingGets); // model
    await resolveNextGet(pendingGets); // credential presence
    await resolveNextGet(pendingGets); // japanese summary
    await flushUntil(() => els.provider.disabled === false);

    assert.equal(els.provider.value, "openai");
    assert.equal(store.get(STORAGE_KEY_PROVIDER), "openai");
    assert.equal(
      store.has(STORAGE_KEY_OPENAI_KEY),
      false,
      "the credential typed during initial load must never have been saved",
    );
    assert.equal(pendingSets.length, 0);
  } finally {
    cleanup();
  }
});

// §15.3: the initial read of the Japanese summary preference is held open,
// and the reader attempts to toggle it while it is still unresolved. PASS
// requires that the stale initial value never overwrites a later confirmed
// action, and that no write reaches storage before the confirmed baseline
// (here, `true`) is known.
test("a Japanese summary toggle attempted before the initial load resolves is refused, and the latest confirmed toggle after that wins", async () => {
  const { chrome, store, calls, pendingGets, pendingSets } = makeFakeChrome(
    { [STORAGE_KEY_JAPANESE_SUMMARY]: true },
    { holdGets: true },
  );
  try {
    const els = await loadOptionsPageWithoutWaiting(chrome);

    await flushUntil(() => pendingGets.length >= 1);

    els["japanese-summary"].checked = false;
    await fire(els["japanese-summary"], "change");
    assert.equal(
      calls.filter(([kind]) => kind === "set-called").length,
      0,
      "a toggle during initial load must not write anything",
    );

    await resolveNextGet(pendingGets); // provider
    await resolveNextGet(pendingGets); // model
    await resolveNextGet(pendingGets); // credential presence
    await resolveNextGet(pendingGets); // japanese summary
    await flushUntil(() => els.provider.disabled === false);

    // The confirmed stored value (true) is what is now shown, not the
    // refused attempt made while it was still loading.
    assert.equal(els["japanese-summary"].checked, true);

    // A real toggle, made only now that the page is ready, is the latest
    // confirmed user action and must be the one left standing.
    els["japanese-summary"].checked = false;
    const change = fire(els["japanese-summary"], "change");
    await flushUntil(() => pendingSets.length === 1);
    pendingSets.shift().resolve();
    await change;

    assert.equal(els["japanese-summary"].checked, false);
    assert.equal(els["japanese-summary-status"].textContent, "Saved.");
    assert.equal(store.get(STORAGE_KEY_JAPANESE_SUMMARY), false);
  } finally {
    cleanup();
  }
});
