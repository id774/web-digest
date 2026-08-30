// Extension settings, their storage keys, and the model default.
//
// Stored settings live in chrome.storage.local, in the reader's own profile.
// Nothing else in the extension names a storage key, and nothing else names
// a model.

export const STORAGE_KEY_TOKEN = "apiToken";
export const STORAGE_KEY_MODEL = "model";
export const STORAGE_KEY_JAPANESE_SUMMARY = "japaneseSummary";

// A name from the Sakura AI Engine's own published list of models, confirmed
// against that list when this constant was written. It is the one place a
// model name appears; a reader who wants another sets it in the options page.
export const DEFAULT_MODEL = "gpt-oss-120b";

// A token is unset when the key is absent, its value is not a string, or it is
// empty after trimming.
export function isTokenSet(value) {
  return typeof value === "string" && value.trim() !== "";
}

// A model is unset when the key is absent or its value is empty after
// trimming, and an unset model is the default.
export function resolveModel(value) {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : DEFAULT_MODEL;
}

// Japanese summary output is on only when the stored value is the boolean
// true. Absent, malformed, or any other stored value resolves to off, so a
// profile upgraded from an earlier version keeps its current behavior.
export function resolveJapaneseSummary(value) {
  return value === true;
}

export async function readSettings() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEY_TOKEN,
    STORAGE_KEY_MODEL,
    STORAGE_KEY_JAPANESE_SUMMARY,
  ]);
  const token = stored[STORAGE_KEY_TOKEN];
  return {
    token: isTokenSet(token) ? token.trim() : "",
    model: resolveModel(stored[STORAGE_KEY_MODEL]),
    japaneseSummary: resolveJapaneseSummary(
      stored[STORAGE_KEY_JAPANESE_SUMMARY],
    ),
  };
}

// Whether a token is configured, without reading the token itself out to a
// caller that has no use for its value.
export async function hasToken() {
  const stored = await chrome.storage.local.get(STORAGE_KEY_TOKEN);
  return isTokenSet(stored[STORAGE_KEY_TOKEN]);
}

export async function readStoredModel() {
  const stored = await chrome.storage.local.get(STORAGE_KEY_MODEL);
  const model = stored[STORAGE_KEY_MODEL];
  return typeof model === "string" ? model : "";
}

export async function readJapaneseSummary() {
  const stored = await chrome.storage.local.get(STORAGE_KEY_JAPANESE_SUMMARY);
  return resolveJapaneseSummary(stored[STORAGE_KEY_JAPANESE_SUMMARY]);
}

export async function saveSettings({ token, model }) {
  await chrome.storage.local.set({
    [STORAGE_KEY_TOKEN]: token,
    [STORAGE_KEY_MODEL]: model,
  });
}

export async function deleteToken() {
  await chrome.storage.local.remove(STORAGE_KEY_TOKEN);
}

// Saved on its own, independent of saveSettings, so that turning this
// preference on or off never requires the token to be re-entered.
export async function saveJapaneseSummary(value) {
  await chrome.storage.local.set({
    [STORAGE_KEY_JAPANESE_SUMMARY]: value === true,
  });
}
