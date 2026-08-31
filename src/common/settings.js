// Extension settings, their storage keys, and the per-provider model defaults.
//
// Stored settings live in chrome.storage.local, in the reader's own profile.
// Nothing else in the extension names a storage key, and nothing else names a
// provider's default model.
//
// Every provider keeps its own credential and model key, so that switching
// the selected provider never deletes, overwrites or moves another
// provider's settings.

export const Provider = {
  SAKURA: "sakura",
  OPENAI: "openai",
  ANTHROPIC: "anthropic",
};

const KNOWN_PROVIDERS = new Set(Object.values(Provider));

export const STORAGE_KEY_PROVIDER = "provider";
export const STORAGE_KEY_TOKEN = "apiToken";
export const STORAGE_KEY_MODEL = "model";
export const STORAGE_KEY_OPENAI_KEY = "openaiApiKey";
export const STORAGE_KEY_OPENAI_MODEL = "openaiModel";
export const STORAGE_KEY_ANTHROPIC_KEY = "anthropicApiKey";
export const STORAGE_KEY_ANTHROPIC_MODEL = "anthropicModel";
export const STORAGE_KEY_JAPANESE_SUMMARY = "japaneseSummary";

// The Sakura AI Engine credential and model keys keep the names they had
// before this project supported more than one provider, so that an existing
// Sakura user's stored settings are read exactly as before, with no migration.
const CREDENTIAL_KEY = {
  [Provider.SAKURA]: STORAGE_KEY_TOKEN,
  [Provider.OPENAI]: STORAGE_KEY_OPENAI_KEY,
  [Provider.ANTHROPIC]: STORAGE_KEY_ANTHROPIC_KEY,
};

const MODEL_KEY = {
  [Provider.SAKURA]: STORAGE_KEY_MODEL,
  [Provider.OPENAI]: STORAGE_KEY_OPENAI_MODEL,
  [Provider.ANTHROPIC]: STORAGE_KEY_ANTHROPIC_MODEL,
};

// A name from each provider's own published list of models, confirmed against
// that list when this constant was written. It is the one place a default
// model name for that provider appears; a reader who wants another sets it in
// the options page.
export const DEFAULT_MODEL = "gpt-oss-120b";
export const OPENAI_DEFAULT_MODEL = "gpt-5.6-terra";
export const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-5";

const DEFAULT_MODEL_BY_PROVIDER = {
  [Provider.SAKURA]: DEFAULT_MODEL,
  [Provider.OPENAI]: OPENAI_DEFAULT_MODEL,
  [Provider.ANTHROPIC]: ANTHROPIC_DEFAULT_MODEL,
};

export const PROVIDER_LABEL = {
  [Provider.SAKURA]: "Sakura AI Engine",
  [Provider.OPENAI]: "OpenAI",
  [Provider.ANTHROPIC]: "Claude",
};

// The provider is Sakura when the stored value is absent, is not a string, or
// is not one of the three supported provider identifiers — never guessed from
// a credential or from a page. This is what lets an existing Sakura user's
// profile, which never wrote this key, keep working unchanged.
export function resolveProvider(value) {
  return typeof value === "string" && KNOWN_PROVIDERS.has(value)
    ? value
    : Provider.SAKURA;
}

// A credential is unset when the key is absent, its value is not a string, or
// it is empty after trimming.
export function isCredentialSet(value) {
  return typeof value === "string" && value.trim() !== "";
}

// Backward-compatible name for the Sakura credential check.
export function isTokenSet(value) {
  return isCredentialSet(value);
}

// A model for a provider is unset when the key is absent, its value is not a
// string, or it is empty after trimming, and an unset model is that
// provider's own default.
export function resolveModelFor(provider, value) {
  const fallback = DEFAULT_MODEL_BY_PROVIDER[provider] || DEFAULT_MODEL;
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : fallback;
}

// Backward-compatible name: the Sakura model resolver existing tests and code
// already call.
export function resolveModel(value) {
  return resolveModelFor(Provider.SAKURA, value);
}

// Japanese summary output is on only when the stored value is the boolean
// true. Absent, malformed, or any other stored value resolves to off, so a
// profile upgraded from an earlier version keeps its current behavior.
export function resolveJapaneseSummary(value) {
  return value === true;
}

// The settings a run needs, fixed once at the start of that run: the selected
// provider, that provider's own credential and model, and the Japanese
// summary preference. A provider switch made after this call never affects
// the run that already read it.
export async function readSettings() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEY_PROVIDER,
    STORAGE_KEY_TOKEN,
    STORAGE_KEY_MODEL,
    STORAGE_KEY_OPENAI_KEY,
    STORAGE_KEY_OPENAI_MODEL,
    STORAGE_KEY_ANTHROPIC_KEY,
    STORAGE_KEY_ANTHROPIC_MODEL,
    STORAGE_KEY_JAPANESE_SUMMARY,
  ]);
  const provider = resolveProvider(stored[STORAGE_KEY_PROVIDER]);
  const credential = stored[CREDENTIAL_KEY[provider]];
  return {
    provider,
    credential: isCredentialSet(credential) ? credential.trim() : "",
    model: resolveModelFor(provider, stored[MODEL_KEY[provider]]),
    japaneseSummary: resolveJapaneseSummary(
      stored[STORAGE_KEY_JAPANESE_SUMMARY],
    ),
  };
}

export async function readStoredProvider() {
  const stored = await chrome.storage.local.get(STORAGE_KEY_PROVIDER);
  return resolveProvider(stored[STORAGE_KEY_PROVIDER]);
}

// Whether a credential is configured for the given provider, without reading
// the credential itself out to a caller that has no use for its value.
export async function hasCredential(provider) {
  const key = CREDENTIAL_KEY[provider];
  const stored = await chrome.storage.local.get(key);
  return isCredentialSet(stored[key]);
}

// Backward-compatible name for the Sakura credential presence check.
export async function hasToken() {
  return hasCredential(Provider.SAKURA);
}

export async function readStoredModel(provider = Provider.SAKURA) {
  const key = MODEL_KEY[provider];
  const stored = await chrome.storage.local.get(key);
  const model = stored[key];
  return typeof model === "string" ? model : "";
}

export async function readJapaneseSummary() {
  const stored = await chrome.storage.local.get(STORAGE_KEY_JAPANESE_SUMMARY);
  return resolveJapaneseSummary(stored[STORAGE_KEY_JAPANESE_SUMMARY]);
}

// Saved on its own: selecting a provider never writes or removes any
// provider's credential or model, and never touches the Japanese summary
// preference.
export async function saveProvider(provider) {
  await chrome.storage.local.set({ [STORAGE_KEY_PROVIDER]: provider });
}

// Writes only the named provider's own credential and model keys, so that
// switching providers back and forth never disturbs another provider's
// stored settings.
export async function saveProviderSettings(provider, { credential, model }) {
  await chrome.storage.local.set({
    [CREDENTIAL_KEY[provider]]: credential,
    [MODEL_KEY[provider]]: model,
  });
}

// Backward-compatible name for saving the Sakura credential and model.
export async function saveSettings({ token, model }) {
  await saveProviderSettings(Provider.SAKURA, { credential: token, model });
}

// Removes only the named provider's own credential. Its model, every other
// provider's settings, the provider selection and the Japanese summary
// preference are left untouched.
export async function deleteCredential(provider) {
  await chrome.storage.local.remove(CREDENTIAL_KEY[provider]);
}

// Backward-compatible name for deleting the Sakura credential.
export async function deleteToken() {
  return deleteCredential(Provider.SAKURA);
}

// Saved on its own, independent of saveProviderSettings, so that turning this
// preference on or off never requires a credential to be re-entered.
export async function saveJapaneseSummary(value) {
  await chrome.storage.local.set({
    [STORAGE_KEY_JAPANESE_SUMMARY]: value === true,
  });
}
