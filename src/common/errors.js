// The error kinds, and the one message the reader is shown for each.
//
// Nothing else in the extension composes a message. A message names the cause
// and what would address it; it carries no status line, no response body, no
// exception, no stack and no API token, and nothing is interpolated into it
// from the page, the answer or the settings.

export const ErrorKind = {
  TOKEN_MISSING: "token-missing",
  TOKEN_REJECTED: "token-rejected",
  ENGINE_UNREACHABLE: "engine-unreachable",
  ENGINE_TIMEOUT: "engine-timeout",
  ENGINE_ERROR: "engine-error",
  PAGE_UNREADABLE: "page-unreadable",
  TOO_LITTLE_TEXT: "too-little-text",
  TOO_MUCH_TEXT: "too-much-text",
  NO_USABLE_SUMMARY: "no-usable-summary",
  INTERNAL_ERROR: "internal-error",
};

// The four fixed values of `detail`, which exists only for `engine-error`.
export const EngineErrorDetail = {
  REFUSED: "refused",
  RATE_LIMITED: "rate-limited",
  UNAVAILABLE: "unavailable",
  UNSPECIFIED: "unspecified",
};

const MESSAGES = {
  [ErrorKind.TOKEN_MISSING]:
    "No API token is configured. Open Settings and enter your Sakura AI Engine token.",
  [ErrorKind.TOKEN_REJECTED]:
    "The AI Engine refused the token. Check it in Settings.",
  [ErrorKind.ENGINE_UNREACHABLE]:
    "The AI Engine could not be reached. Check your connection and try again.",
  [ErrorKind.ENGINE_TIMEOUT]:
    "The AI Engine took too long to answer. Trying again is reasonable.",
  [ErrorKind.PAGE_UNREADABLE]:
    "The content of this page could not be obtained. Run it from the toolbar button on the page itself.",
  [ErrorKind.TOO_LITTLE_TEXT]: "This page has too little text to summarize.",
  [ErrorKind.TOO_MUCH_TEXT]:
    "This page is larger than can be summarized in one request.",
  [ErrorKind.NO_USABLE_SUMMARY]:
    "No summary came back. Trying again is reasonable.",
  [ErrorKind.INTERNAL_ERROR]:
    "The extension failed to complete the run. Trying again is reasonable.",
};

const ENGINE_ERROR_MESSAGES = {
  [EngineErrorDetail.RATE_LIMITED]:
    "The AI Engine reported a rate limit. Try again later.",
  [EngineErrorDetail.REFUSED]:
    "The AI Engine refused the request. Check the model name in Settings.",
  [EngineErrorDetail.UNAVAILABLE]:
    "The AI Engine reported an error. Trying again later is reasonable.",
  [EngineErrorDetail.UNSPECIFIED]: "The AI Engine reported an error.",
};

// The message for a kind, chosen by the kind alone. A kind with no message is
// a fault of this repository, and the internal-error message stands in for it
// rather than leaving the panel blank.
export function messageFor(kind, detail) {
  if (kind === ErrorKind.ENGINE_ERROR) {
    return (
      ENGINE_ERROR_MESSAGES[detail] ||
      ENGINE_ERROR_MESSAGES[EngineErrorDetail.UNSPECIFIED]
    );
  }
  return MESSAGES[kind] || MESSAGES[ErrorKind.INTERNAL_ERROR];
}
