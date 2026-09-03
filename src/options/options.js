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
};

const DEFAULT_MODEL_FOR = {
  [Provider.SAKURA]: DEFAULT_MODEL,
  [Provider.OPENAI]: OPENAI_DEFAULT_MODEL,
  [Provider.ANTHROPIC]: ANTHROPIC_DEFAULT_MODEL,
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

// Switching to a provider whose host permission is optional (OpenAI, Claude)
// requests that permission, through the reader's own action on this page,
// before the provider selection is saved. Sakura needs none. Granting saves
// the new selection; denying leaves the previous provider selected and
// touches no credential or model of any provider.
//
// A permission denial or rejected request and a storage write failure are
// both `{ ok: false, provider }`, so the previous provider is kept either
// way — but only the write failure carries `reason: "storage"`, since the
// two are told apart in the UI with a different message. A permission
// already granted is never revoked because the write that would have used
// it failed: that side effect stays exactly what Chrome recorded.
export async function changeProvider({
  provider,
  permissionsApi,
  requestPermission = requestProviderPermission,
  needsPermission = needsOptionalPermission,
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
  try {
    await save(provider);
  } catch {
    return { ok: false, provider, reason: "storage" };
  }
  return { ok: true, provider };
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

  async function refreshCredentialStatus(provider) {
    fields.credentialStatus.textContent = (await hasCredential(provider))
      ? "A credential is configured."
      : "No credential is configured.";
  }

  async function loadProviderFields(provider) {
    applyProviderLabels(provider);
    // The credential field is never prefilled, whatever is stored: a field
    // the reader is about to overwrite does not have to display one.
    fields.credential.value = "";
    fields.model.value = await readStoredModel(provider);
    await refreshCredentialStatus(provider);
  }

  async function load() {
    currentProvider = await readStoredProvider();
    fields.provider.value = currentProvider;
    await loadProviderFields(currentProvider);
    confirmedJapaneseSummary = await readJapaneseSummary();
    fields.japaneseSummary.checked = confirmedJapaneseSummary;
  }

  // Every provider-scoped operation below starts by claiming this single
  // lock and starts nothing else while it holds it, so no operation can ever
  // observe another one's half-finished state — there is only ever a
  // previous confirmed state or this one's own outcome, never both at once.
  fields.provider.addEventListener("change", async () => {
    if (providerBusy) {
      fields.provider.value = currentProvider;
      return;
    }
    const requested = fields.provider.value;
    providerBusy = true;
    setProviderControlsDisabled(true);
    try {
      const result = await changeProvider({ provider: requested });
      if (!result.ok) {
        fields.provider.value = currentProvider;
        sayProvider(
          result.reason === "storage"
            ? "The provider could not be saved. The provider was not changed."
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
      await loadProviderFields(currentProvider);
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
    if (providerBusy) return;
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
    if (providerBusy) return;
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
      fields.credential.value = "";
      await refreshCredentialStatus(provider);
      say("Saved.");
    } finally {
      providerBusy = false;
      setProviderControlsDisabled(false);
    }
  });

  fields.remove.addEventListener("click", async () => {
    if (providerBusy) return;
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
      fields.credential.value = "";
      await refreshCredentialStatus(provider);
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
    const requested = fields.japaneseSummary.checked;
    japaneseSummaryQueue = japaneseSummaryQueue.catch(() => {}).then(async () => {
      try {
        await saveJapaneseSummary(requested);
      } catch {
        fields.japaneseSummary.checked = confirmedJapaneseSummary;
        sayJapaneseSummary(
          "The Japanese summary preference could not be saved.",
        );
        return;
      }
      confirmedJapaneseSummary = requested;
      sayJapaneseSummary("Saved.");
    });
    return japaneseSummaryQueue;
  });

  load();
}

if (typeof document !== "undefined") {
  wire();
}
