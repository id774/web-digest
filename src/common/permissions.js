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

// Calls chrome.permissions.request() directly, from within the caller's own
// user gesture (the provider selector's change event), for OpenAI and Claude.
// Sakura's permission is required, not optional, so it is never requested.
// This does not wait on hasProviderPermission() / permissions.contains()
// first: Chrome itself resolves without a prompt when the permission already
// holds, and an asynchronous pre-check here would only risk losing the user
// gesture before request() runs. Checking whether a permission already holds
// is hasProviderPermission()'s job, at the start of a run.
export async function requestProviderPermission(
  provider,
  permissionsApi = chrome.permissions,
) {
  if (!needsOptionalPermission(provider)) return true;
  return await permissionsApi.request({
    origins: [PROVIDER_HOST_PERMISSION[provider]],
  });
}
