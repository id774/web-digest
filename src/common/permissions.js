// The optional host permissions OpenAI and Claude need, and nothing about the
// Sakura AI Engine, whose host permission is required and always granted.
//
// Nothing here ever requests a permission on its own initiative: requesting
// happens only from the reader's explicit action in the options page (see
// options.js), and a run only ever checks whether a permission already holds.

import { Provider } from "./settings.js";

export const PROVIDER_HOST_PERMISSION = {
  [Provider.OPENAI]: "https://api.openai.com/*",
  [Provider.ANTHROPIC]: "https://api.anthropic.com/*",
};

// Sakura's host permission is required in the manifest and is always present;
// OpenAI's and Claude's are optional and may or may not have been granted.
export function needsOptionalPermission(provider) {
  return Object.prototype.hasOwnProperty.call(
    PROVIDER_HOST_PERMISSION,
    provider,
  );
}

// True for Sakura without asking the browser anything, since Sakura's host
// permission is required rather than optional.
export async function hasProviderPermission(
  provider,
  permissionsApi = chrome.permissions,
) {
  if (!needsOptionalPermission(provider)) return true;
  return await permissionsApi.contains({
    origins: [PROVIDER_HOST_PERMISSION[provider]],
  });
}

// Prompts the reader, through the browser's own permission UI, only when the
// permission is not already held. Resolves to whether the permission holds
// afterward, granted just now or already in place.
export async function requestProviderPermission(
  provider,
  permissionsApi = chrome.permissions,
) {
  if (!needsOptionalPermission(provider)) return true;
  if (await hasProviderPermission(provider, permissionsApi)) return true;
  return await permissionsApi.request({
    origins: [PROVIDER_HOST_PERMISSION[provider]],
  });
}
