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
  await save(provider);
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

  function say(text) {
    fields.status.textContent = text;
  }

  function sayProvider(text) {
    fields.providerStatus.textContent = text;
  }

  function sayJapaneseSummary(text) {
    fields.japaneseSummaryStatus.textContent = text;
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
    fields.japaneseSummary.checked = await readJapaneseSummary();
  }

  fields.provider.addEventListener("change", async () => {
    const requested = fields.provider.value;
    const result = await changeProvider({ provider: requested });
    if (!result.ok) {
      fields.provider.value = currentProvider;
      sayProvider(
        `Permission for ${PROVIDER_LABEL[requested]} was not granted. The provider was not changed.`,
      );
      return;
    }
    currentProvider = requested;
    await loadProviderFields(currentProvider);
    sayProvider(`Now using ${PROVIDER_LABEL[currentProvider]}.`);
  });

  // A direct restore path for a permission Chrome revoked after it was
  // granted: it only requests, never changes the provider, a credential, a
  // model or the Japanese summary preference.
  fields.grantPermission.addEventListener("click", async () => {
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
  });

  fields.save.addEventListener("click", async () => {
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
    await saveProviderSettings(currentProvider, {
      credential: credential.value,
      model: model.value,
    });
    fields.credential.value = "";
    await refreshCredentialStatus(currentProvider);
    say("Saved.");
  });

  fields.remove.addEventListener("click", async () => {
    await deleteCredential(currentProvider);
    fields.credential.value = "";
    await refreshCredentialStatus(currentProvider);
    say("The credential was deleted.");
  });

  // Independent of Save above: changing this preference neither requires nor
  // touches a credential or a model, of the selected provider or any other.
  fields.japaneseSummary.addEventListener("change", async () => {
    await saveJapaneseSummary(fields.japaneseSummary.checked);
    sayJapaneseSummary("Saved.");
  });

  load();
}

if (typeof document !== "undefined") {
  wire();
}
