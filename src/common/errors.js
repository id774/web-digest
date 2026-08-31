// The error kinds, and the one message the reader is shown for each.
//
// Nothing else in the extension composes a message. A message names the cause
// and what would address it; it carries no status line, no response body, no
// exception, no stack and no credential, and nothing is interpolated into it
// from the page, the answer or the settings.
//
// The kinds are provider-neutral: a run may use the Sakura AI Engine, OpenAI
// or Claude, and the reader is told about "the selected AI provider" rather
// than about one of them by name, whichever one was actually chosen.

export const ErrorKind = {
  CREDENTIAL_MISSING: "credential-missing",
  CREDENTIAL_REJECTED: "credential-rejected",
  PROVIDER_UNREACHABLE: "provider-unreachable",
  TIMEOUT: "timeout",
  PROVIDER_ERROR: "provider-error",
  PAGE_UNREADABLE: "page-unreadable",
  TOO_LITTLE_TEXT: "too-little-text",
  TOO_MUCH_TEXT: "too-much-text",
  NO_USABLE_SUMMARY: "no-usable-summary",
  INTERNAL_ERROR: "internal-error",
  PERMISSION_MISSING: "permission-missing",
};

// The four fixed values of `detail`, which exists only for `provider-error`.
export const ProviderErrorDetail = {
  REFUSED: "refused",
  RATE_LIMITED: "rate-limited",
  UNAVAILABLE: "unavailable",
  UNSPECIFIED: "unspecified",
};

const MESSAGES = {
  [ErrorKind.CREDENTIAL_MISSING]:
    "No API credential is configured for the selected AI provider. Open Settings and enter one.",
  [ErrorKind.CREDENTIAL_REJECTED]:
    "The selected AI provider refused the credential. Check it in Settings.",
  [ErrorKind.PROVIDER_UNREACHABLE]:
    "The selected AI provider could not be reached. Check your connection and try again.",
  [ErrorKind.TIMEOUT]:
    "The selected AI provider took too long to answer. Trying again is reasonable.",
  [ErrorKind.PAGE_UNREADABLE]:
    "The content of this page could not be obtained.",
  [ErrorKind.TOO_LITTLE_TEXT]: "This page has too little text to summarize.",
  [ErrorKind.TOO_MUCH_TEXT]:
    "This page is larger than can be summarized in one request.",
  [ErrorKind.NO_USABLE_SUMMARY]:
    "No summary came back. Trying again is reasonable.",
  [ErrorKind.INTERNAL_ERROR]:
    "The extension failed to complete the run. Trying again is reasonable.",
  [ErrorKind.PERMISSION_MISSING]:
    "Browser permission for the selected AI provider is missing. Open Settings to grant it again.",
};

const PROVIDER_ERROR_MESSAGES = {
  [ProviderErrorDetail.RATE_LIMITED]:
    "The selected AI provider reported a rate limit. Try again later.",
  [ProviderErrorDetail.REFUSED]:
    "The selected AI provider refused the request. Check the model name in Settings.",
  [ProviderErrorDetail.UNAVAILABLE]:
    "The selected AI provider reported an error. Trying again later is reasonable.",
  [ProviderErrorDetail.UNSPECIFIED]:
    "The selected AI provider reported an error.",
};

// The message for a kind, chosen by the kind alone. A kind with no message is
// a fault of this repository, and the internal-error message stands in for it
// rather than leaving the panel blank.
export function messageFor(kind, detail) {
  if (kind === ErrorKind.PROVIDER_ERROR) {
    return (
      PROVIDER_ERROR_MESSAGES[detail] ||
      PROVIDER_ERROR_MESSAGES[ProviderErrorDetail.UNSPECIFIED]
    );
  }
  return MESSAGES[kind] || MESSAGES[ErrorKind.INTERNAL_ERROR];
}
