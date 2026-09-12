// The settings document: the provider, its credential and model, and the
// Japanese summary preference, and nothing else.
//
// Nothing is validated by contacting a provider. A credential that does not
// work is discovered by the first run that uses it, and reported as an error
// kind. Switching the provider never touches another provider's stored
// credential or model, and never requires re-entering one.

import {
  ANTHROPIC_DEFAULT_MODEL,
  DEFAULT_MODEL,
  KIMI_DEFAULT_MODEL,
  OPENAI_DEFAULT_MODEL,
  PROVIDER_LABEL,
  Provider,
  deleteCredential,
  hasCredential,
  readJapaneseSummary,
  readStoredModel,
  readStoredProvider,
  saveJapaneseSummary,
  saveProvider,
  saveProviderSettings,
} from "../common/settings.js";
import {
  needsOptionalPermission,
  requestProviderPermission,
} from "../common/permissions.js";

const HAS_WHITESPACE = /\s/;

const CREDENTIAL_LABEL = {
  [Provider.SAKURA]: "Sakura AI Engine API token",
  [Provider.OPENAI]: "OpenAI API key",
  [Provider.ANTHROPIC]: "Claude API key",
  [Provider.KIMI]: "Kimi API key",
};

const DEFAULT_MODEL_FOR = {
  [Provider.SAKURA]: DEFAULT_MODEL,
  [Provider.OPENAI]: OPENAI_DEFAULT_MODEL,
  [Provider.ANTHROPIC]: ANTHROPIC_DEFAULT_MODEL,
  [Provider.KIMI]: KIMI_DEFAULT_MODEL,
};

// Saving with an empty credential field is refused rather than treated as a
// deletion, so that an accidental save cannot silently clear a working
// credential. Deleting is its own button.
export function validateCredential(value) {
  const credential = String(value).trim();
  if (credential === "") return { ok: false, message: "Enter a credential." };
  if (HAS_WHITESPACE.test(credential)) {
    return {
      ok: false,
      message: "A credential contains no spaces or line breaks.",
    };
  }
  return { ok: true, value: credential };
}

export function validateModel(value) {
  const model = String(value).trim();
  if (model === "") return { ok: true, value: "" };
  if (HAS_WHITESPACE.test(model)) {
    return { ok: false, message: "A model name contains no spaces." };
  }
  return { ok: true, value: model };
}

// Switching to a provider whose host permission is optional (OpenAI, Claude,
// Kimi) requests that permission, through the reader's own action on this page,
// before the provider selection is saved. Sakura needs none. Granting saves
// the new selection; denying leaves the previous provider selected and
// touches no credential or model of any provider.
//
// `readSnapshot`, when given, is awaited after permission is granted and
// before the provider selection is saved: it is how the caller reads the
// target provider's own fields while the previous provider is still the one
// committed, so a read failure can refuse the commit outright rather than
// leave the provider changed with fields that never loaded. Omitting it
// (the default) skips that step entirely, unchanged from before it existed.
//
// A permission denial or rejected request, a snapshot read failure and a
// storage write failure are all `{ ok: false, provider }`, so the previous
// provider is kept either way — but the read failure carries
// `reason: "read"` and the write failure `reason: "storage"`, since the UI
// tells the three apart with a different message. A permission already
// granted is never revoked because a later read or write failed: that side
// effect stays exactly what Chrome recorded.
export async function changeProvider({
  provider,
  permissionsApi,
  requestPermission = requestProviderPermission,
  needsPermission = needsOptionalPermission,
  readSnapshot,
  save = saveProvider,
}) {
  if (needsPermission(provider)) {
    let granted;
    try {
      granted = await requestPermission(provider, permissionsApi);
    } catch {
      return { ok: false, provider };
    }
    if (!granted) return { ok: false, provider };
  }
  let snapshot;
  if (readSnapshot) {
    try {
      snapshot = await readSnapshot(provider);
    } catch {
      return { ok: false, provider, reason: "read" };
    }
  }
  try {
    await save(provider);
  } catch {
    return { ok: false, provider, reason: "storage" };
  }
  return snapshot === undefined
    ? { ok: true, provider }
    : { ok: true, provider, snapshot };
}

function wire() {
  const fields = {
    provider: document.getElementById("provider"),
    providerStatus: document.getElementById("provider-status"),
    grantPermission: document.getElementById("grant-permission"),
    credential: document.getElementById("credential"),
    credentialLabel: document.getElementById("credential-label"),
    credentialStatus: document.getElementById("credential-status"),
    model: document.getElementById("model"),
    save: document.getElementById("save"),
    remove: document.getElementById("delete"),
    status: document.getElementById("status"),
    japaneseSummary: document.getElementById("japanese-summary"),
    japaneseSummaryStatus: document.getElementById("japanese-summary-status"),
  };

  let currentProvider = Provider.SAKURA;
  let confirmedJapaneseSummary = false;

  // True until the stored provider, its fields, and the Japanese summary
  // preference have all been read back at least once. `currentProvider` and
  // `confirmedJapaneseSummary` are provisional defaults until then — not yet
  // what is actually stored — so no provider-scoped or preference mutation
  // may be based on them while this is true. Every handler below checks it
  // first, rather than relying on the controls' own `disabled` attribute,
  // exactly the way `providerBusy` is checked below rather than trusted to
  // the DOM alone.
  let initializing = true;

  // Provider selection, Save, Delete credential and Grant/restore permission
  // all read or write the selected provider's own fields, so at most one of
  // them runs at a time: starting one while another is still in flight is
  // exactly how a stale completion could overwrite a provider confirmed
  // after it started (§6.6 of the requirements this fixes). Japanese summary
  // is provider-independent and is not gated by this lock.
  let providerBusy = false;

  // Serializes this preference's own saves so two overlapping toggles can
  // never race in storage itself: a generation check on the UI alone would
  // still let an older `chrome.storage.local.set` land after a newer one
  // and leave the *stored* value reversed, which the next run would read.
  // Queuing means the write for a later toggle only starts once the
  // previous one has fully landed, so the last one issued is always the
  // one left standing.
  let japaneseSummaryQueue = Promise.resolve();

  // A private counter, not stored anywhere: each accepted toggle captures
  // the generation current at that moment, and a completed queue item only
  // touches the checkbox and its status when its own generation still
  // matches the latest one. This is what stops an older completion —
  // success or failure — from overwriting a newer pending choice, while the
  // storage write it produced still always advances the last confirmed
  // value below.
  let japaneseSummaryGeneration = 0;

  function say(text) {
    fields.status.textContent = text;
  }

  function sayProvider(text) {
    fields.providerStatus.textContent = text;
  }

  function sayJapaneseSummary(text) {
    fields.japaneseSummaryStatus.textContent = text;
  }

  function setProviderControlsDisabled(disabled) {
    fields.provider.disabled = disabled;
    fields.save.disabled = disabled;
    fields.remove.disabled = disabled;
    fields.grantPermission.disabled = disabled;
    fields.credential.disabled = disabled;
    fields.model.disabled = disabled;
  }

  function applyProviderLabels(provider) {
    fields.credentialLabel.textContent = CREDENTIAL_LABEL[provider];
    fields.model.placeholder = DEFAULT_MODEL_FOR[provider];
    fields.grantPermission.hidden = !needsOptionalPermission(provider);
  }

  // Reads a provider's own model and credential-presence together, without
  // touching the DOM or the stored provider selection — the pre-commit
  // snapshot a provider change needs before it may commit that selection
  // (§7.2 of the detailed design), and also what the initial load applies
  // for the provider it finds already stored.
  async function readProviderSnapshot(provider) {
    const [model, credentialPresent] = await Promise.all([
      readStoredModel(provider),
      hasCredential(provider),
    ]);
    return { model, credentialPresent };
  }

  // Applies an already-read snapshot to the DOM. This never itself reads
  // storage, so it cannot fail partway through with some fields updated and
  // others not: a snapshot is either fully applied or not applied at all.
  function applyProviderSnapshot(provider, snapshot) {
    applyProviderLabels(provider);
    // The credential field is never prefilled, whatever is stored: a field
    // the reader is about to overwrite does not have to display one.
    fields.credential.value = "";
    fields.model.value = snapshot.model;
    fields.credentialStatus.textContent = snapshot.credentialPresent
      ? "A credential is configured."
      : "No credential is configured.";
  }

  async function loadProviderFields(provider) {
    applyProviderSnapshot(provider, await readProviderSnapshot(provider));
  }

  async function load() {
    try {
      currentProvider = await readStoredProvider();
      fields.provider.value = currentProvider;
      await loadProviderFields(currentProvider);
      confirmedJapaneseSummary = await readJapaneseSummary();
      fields.japaneseSummary.checked = confirmedJapaneseSummary;
    } catch {
      // The confirmed provider and preference are still unknown: mutations
      // stay refused (initializing stays true) rather than risk one landing
      // against a guessed value, and this is reported as the failure it is,
      // never displayed as a successfully loaded — and so mutable — state.
      say("Settings could not be loaded. Reload the page to try again.");
      return;
    }
    initializing = false;
    setProviderControlsDisabled(false);
    fields.japaneseSummary.disabled = false;
  }

  // Every provider-scoped operation below starts by claiming this single
  // lock and starts nothing else while it holds it, so no operation can ever
  // observe another one's half-finished state — there is only ever a
  // previous confirmed state or this one's own outcome, never both at once.
  fields.provider.addEventListener("change", async () => {
    if (initializing || providerBusy) {
      fields.provider.value = currentProvider;
      return;
    }
    const requested = fields.provider.value;
    providerBusy = true;
    setProviderControlsDisabled(true);
    try {
      const result = await changeProvider({
        provider: requested,
        readSnapshot: readProviderSnapshot,
      });
      if (!result.ok) {
        fields.provider.value = currentProvider;
        sayProvider(
          result.reason === "storage"
            ? "The provider could not be saved. The provider was not changed."
            : result.reason === "read"
              ? "The provider settings could not be loaded. The provider was not changed."
              : `Permission for ${PROVIDER_LABEL[requested]} was not granted. The provider was not changed.`,
        );
        return;
      }
      currentProvider = requested;
      // Restated rather than assumed: an ignored, conflicting change during
      // this same transaction (§7.3) reverts the control to the provider
      // confirmed at that moment, which by then is the *previous* one — so
      // the control has to be put back to this transaction's own result
      // explicitly once it wins, not left to whatever the DOM still shows.
      fields.provider.value = currentProvider;
      // The snapshot was already read before the provider selection was
      // committed to storage (§7.2), so applying it here is a pure DOM
      // update — no further, fallible storage read stands between a
      // committed selection and the fields the reader sees for it.
      applyProviderSnapshot(currentProvider, result.snapshot);
      sayProvider(`Now using ${PROVIDER_LABEL[currentProvider]}.`);
    } finally {
      providerBusy = false;
      setProviderControlsDisabled(false);
    }
  });

  // A direct restore path for a permission Chrome revoked after it was
  // granted: it only requests, never changes the provider, a credential, a
  // model or the Japanese summary preference.
  fields.grantPermission.addEventListener("click", async () => {
    if (initializing || providerBusy) return;
    providerBusy = true;
    setProviderControlsDisabled(true);
    try {
      let granted;
      try {
        granted = await requestProviderPermission(currentProvider);
      } catch {
        granted = false;
      }

      if (!granted) {
        sayProvider(
          `Permission for ${PROVIDER_LABEL[currentProvider]} was not granted.`,
        );
        return;
      }

      sayProvider(`Permission for ${PROVIDER_LABEL[currentProvider]} is granted.`);
    } finally {
      providerBusy = false;
      setProviderControlsDisabled(false);
    }
  });

  fields.save.addEventListener("click", async () => {
    if (initializing || providerBusy) return;
    const credential = validateCredential(fields.credential.value);
    if (!credential.ok) {
      say(credential.message);
      return;
    }
    const model = validateModel(fields.model.value);
    if (!model.ok) {
      say(model.message);
      return;
    }
    const provider = currentProvider;
    providerBusy = true;
    setProviderControlsDisabled(true);
    try {
      try {
        await saveProviderSettings(provider, {
          credential: credential.value,
          model: model.value,
        });
      } catch {
        say("The settings could not be saved.");
        return;
      }
      // The write above already resolved: the credential and model are
      // committed, so this is a pure DOM update, never a read-back of what
      // was just written.
      fields.credential.value = "";
      fields.credentialStatus.textContent = "A credential is configured.";
      say("Saved.");
    } finally {
      providerBusy = false;
      setProviderControlsDisabled(false);
    }
  });

  fields.remove.addEventListener("click", async () => {
    if (initializing || providerBusy) return;
    const provider = currentProvider;
    providerBusy = true;
    setProviderControlsDisabled(true);
    try {
      try {
        await deleteCredential(provider);
      } catch {
        say("The credential could not be deleted.");
        return;
      }
      // The removal above already resolved: the credential is gone, so this
      // is a pure DOM update, never a read-back of what was just removed.
      fields.credential.value = "";
      fields.credentialStatus.textContent = "No credential is configured.";
      say("The credential was deleted.");
    } finally {
      providerBusy = false;
      setProviderControlsDisabled(false);
    }
  });

  // Independent of Save above: changing this preference neither requires nor
  // touches a credential or a model, of the selected provider or any other.
  // The requested value is captured now, synchronously, from the checkbox
  // the reader just changed — never re-read later, so a still-queued save
  // is unaffected by another one's revert running ahead of it.
  fields.japaneseSummary.addEventListener("change", () => {
    if (initializing) {
      fields.japaneseSummary.checked = confirmedJapaneseSummary;
      return;
    }
    const requested = fields.japaneseSummary.checked;
    japaneseSummaryGeneration += 1;
    const generation = japaneseSummaryGeneration;
    japaneseSummaryQueue = japaneseSummaryQueue.catch(() => {}).then(async () => {
      try {
        await saveJapaneseSummary(requested);
      } catch {
        // The stored value, and any newer pending choice, are untouched by
        // an older failure: the checkbox and status are only reverted here
        // when this completion still belongs to the latest generation.
        if (generation === japaneseSummaryGeneration) {
          fields.japaneseSummary.checked = confirmedJapaneseSummary;
          sayJapaneseSummary(
            "The Japanese summary preference could not be saved.",
          );
        }
        return;
      }
      // The write above already resolved, so the storage-backed confirmed
      // value always advances — even for an older generation — but the
      // checkbox and status only follow it when this is still the latest
      // requested toggle.
      confirmedJapaneseSummary = requested;
      if (generation === japaneseSummaryGeneration) {
        fields.japaneseSummary.checked = confirmedJapaneseSummary;
        sayJapaneseSummary("Saved.");
      }
    });
    return japaneseSummaryQueue;
  });

  // Disabled until load() confirms what is actually stored, so nothing
  // above can be reached — by a real click or by a handler invoked directly
  // — while `currentProvider` and `confirmedJapaneseSummary` are still the
  // provisional defaults set above, not the reader's saved settings.
  setProviderControlsDisabled(true);
  fields.japaneseSummary.disabled = true;
  load();
}

if (typeof document !== "undefined") {
  wire();
}
