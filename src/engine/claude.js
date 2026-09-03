// The only module that speaks to Claude.
//
// Nothing else knows the endpoint, the header, the body or the shape of the
// answer. The credential is a parameter: it is never stored here, never
// logged here and never returned from here.
//
// This uses Anthropic's native Messages API, never an OpenAI-compatible
// endpoint or a compatibility layer. No tool, no web search or fetch, no
// prompt caching, no service tier selection, no sampling tuning and no
// streaming is used. No model-specific thinking configuration is sent: the
// selected model uses whichever thinking default Anthropic has defined for
// it, and this adapter never branches its behaviour on the model name.

import { ErrorKind, ProviderErrorDetail } from "../common/errors.js";
import { sendRequest, REQUEST_TIMEOUT_MS } from "./transport.js";

export const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
export const ANTHROPIC_VERSION = "2023-06-01";

// The Messages API requires `max_tokens`, so this extension sends 32768 on
// every request. This is this extension's own fixed request-level output
// limit — not a reader-facing setting, not a summary target length, not the
// Messages API's own hard output ceiling, and not the selected Claude
// model's maximum output capability (that capability is Anthropic's own,
// provider-side, and is not what this constant describes). The prompt's own
// "no target length" instruction is what actually governs how long a
// summary is.
export const MAX_OUTPUT_TOKENS = 32768;

// Matched, not parsed. An endpoint that words its refusal differently falls
// through to provider-error, which is a worse message but never a wrong one.
// A bare "too long" / "too large" is deliberately absent: those words also
// appear in validation errors unrelated to size, so a generic marker would
// misclassify them as too-much-text. "prompt is too long" and
// "request_too_large" are Anthropic's own documented wordings and stay as
// exact phrases; `SIZE_TARGET_TOO_LONG` below covers other free-form size
// refusals that still name what is too long.
const LENGTH_MARKERS = [
  "context_length",
  "context length",
  "maximum context",
  "prompt is too long",
  "request_too_large",
];

// A free-form message counts as a size refusal only when it names a size
// target — context, input, prompt or request — close to "too long" / "too
// large". "input too long" matches; "identifier is too long" does not, since
// "identifier" is not a size target.
const SIZE_TARGET_TOO_LONG =
  /\b(context|input|prompt|request)\b[\s\S]{0,20}\b(too long|too large)\b/;

// The trusted instruction becomes the top-level `system`; the material — the
// page, chunk or integration text — becomes the one user message. Nothing of
// this project's own protocol is invented: this is the documented shape of a
// Messages request.
export function buildRequest({ model, instruction, content, credential }) {
  return {
    url: `${ANTHROPIC_BASE_URL}/messages`,
    method: "POST",
    headers: {
      "x-api-key": credential,
      "anthropic-version": ANTHROPIC_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      system: instruction,
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: [{ role: "user", content }],
    }),
  };
}

function namesALengthProblem(data) {
  const error = data && data.error ? data.error : {};
  const haystack = `${error.type || ""} ${error.message || ""}`.toLowerCase();
  return (
    LENGTH_MARKERS.some((marker) => haystack.includes(marker)) ||
    SIZE_TARGET_TOO_LONG.test(haystack)
  );
}

export function mapHttpFailure(status, data) {
  if (status === 401) {
    return { ok: false, kind: ErrorKind.CREDENTIAL_REJECTED, status };
  }
  if (
    (status === 400 || status === 413 || status === 422) &&
    namesALengthProblem(data)
  ) {
    return { ok: false, kind: ErrorKind.TOO_MUCH_TEXT, status };
  }
  // Anthropic's own documented meaning for HTTP 402: a billing_error, which
  // only the provider account's billing/usage settings can resolve.
  if (status === 402) {
    return {
      ok: false,
      kind: ErrorKind.PROVIDER_ERROR,
      detail: ProviderErrorDetail.ACCOUNT_LIMIT,
      status,
    };
  }
  // Anthropic's own documented meaning for HTTP 504: a timeout_error. The
  // reader's next action is the same as any other timeout, so this is kept
  // as ErrorKind.TIMEOUT rather than provider-error/unavailable.
  if (status === 504) {
    return { ok: false, kind: ErrorKind.TIMEOUT, status };
  }
  if (status === 404) {
    return {
      ok: false,
      kind: ErrorKind.PROVIDER_ERROR,
      detail: ProviderErrorDetail.REFUSED,
      status,
    };
  }
  if (status === 429) {
    return {
      ok: false,
      kind: ErrorKind.PROVIDER_ERROR,
      detail: ProviderErrorDetail.RATE_LIMITED,
      status,
    };
  }
  // 529 is Anthropic's own "overloaded" status, alongside the ordinary 5xx
  // range: both are the provider reporting that it, not the request, failed.
  if (status === 529 || status >= 500) {
    return {
      ok: false,
      kind: ErrorKind.PROVIDER_ERROR,
      detail: ProviderErrorDetail.UNAVAILABLE,
      status,
    };
  }
  return {
    ok: false,
    kind: ErrorKind.PROVIDER_ERROR,
    detail: ProviderErrorDetail.UNSPECIFIED,
    status,
  };
}

// The concatenation of every text block's text, trimmed, is the summary.
// `max_tokens` and `model_context_window_exceeded` are truncated responses:
// the answer ended at a ceiling rather than completing normally. `refusal`
// is Claude declining to answer. None of these is shown as a summary, even
// if it carries text — a cut-off or declined fragment is worse than being
// told the run failed. A response with no text block at all, or only empty
// ones, is the same no-usable-summary case.
const UNUSABLE_STOP_REASONS = new Set([
  "max_tokens",
  "refusal",
  "model_context_window_exceeded",
]);

export function readAnswer(data) {
  if (!data || typeof data !== "object") {
    return { ok: false, kind: ErrorKind.NO_USABLE_SUMMARY };
  }
  if (UNUSABLE_STOP_REASONS.has(data.stop_reason)) {
    return { ok: false, kind: ErrorKind.NO_USABLE_SUMMARY };
  }
  const blocks = Array.isArray(data.content) ? data.content : [];
  const text = blocks
    .filter((block) => block && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("")
    .trim();
  if (text === "") return { ok: false, kind: ErrorKind.NO_USABLE_SUMMARY };
  return { ok: true, summary: text };
}

export async function callClaude(
  { model, instruction, content, credential },
  { fetchImpl, timeoutMs = REQUEST_TIMEOUT_MS } = {},
) {
  const request = buildRequest({ model, instruction, content, credential });
  const result = await sendRequest(request, { fetchImpl, timeoutMs });
  if (result.timedOut) return { ok: false, kind: ErrorKind.TIMEOUT };
  if (result.unreachable) {
    return { ok: false, kind: ErrorKind.PROVIDER_UNREACHABLE };
  }
  if (!result.ok) return mapHttpFailure(result.status, result.data);
  return readAnswer(result.data);
}
