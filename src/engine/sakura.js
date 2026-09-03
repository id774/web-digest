// The only module that speaks to the Sakura AI Engine.
//
// Nothing else knows the endpoint, the header, the body or the shape of the
// answer. The credential is a parameter: it is never stored here, never
// logged here and never returned from here.
//
// This adapter's protocol is unchanged from before this project supported
// more than one provider: the same endpoint, the same OpenAI-compatible chat
// completions body, the same response handling. Multi-provider support does
// not change what an existing Sakura user's requests look like on the wire.

import { ErrorKind, ProviderErrorDetail } from "../common/errors.js";
import { sendRequest, REQUEST_TIMEOUT_MS } from "./transport.js";

// The service's OpenAI-compatible API base. The official Sakura AI Engine
// documentation is the authority for it; this constant is the one place an
// implementation records what that documentation says. It is not a setting,
// which is what lets the manifest name exactly one required origin for it.
export const SAKURA_BASE_URL = "https://api.ai.sakura.ad.jp/v1";

// Matched, not parsed. An endpoint that words its refusal differently falls
// through to provider-error, which is a worse message but never a wrong one.
// A bare "too long" / "too large" is deliberately absent: those words also
// appear in validation errors unrelated to size, so a generic marker would
// misclassify them as too-much-text. `SIZE_TARGET_TOO_LONG` below covers
// free-form size refusals that still name what is too long.
const LENGTH_MARKERS = ["context_length", "context length", "maximum context"];

// A free-form message counts as a size refusal only when it names a size
// target — context, input, prompt or request — close to "too long" / "too
// large". "input too long" matches; "parameter value is too large" does not,
// since "parameter" is not a size target.
const SIZE_TARGET_TOO_LONG =
  /\b(context|input|prompt|request)\b[\s\S]{0,20}\b(too long|too large)\b/;

// model and messages are the only members sent. max_tokens and temperature are
// not: a character count is not the constraint and neither is a setting, so
// there is no value for either this design could honestly supply. stream is
// not sent, and each answer arrives whole.
export function buildRequest({ model, instruction, content, credential }) {
  const messages = [
    { role: "system", content: instruction },
    { role: "user", content },
  ];
  return {
    url: `${SAKURA_BASE_URL}/chat/completions`,
    method: "POST",
    headers: {
      Authorization: `Bearer ${credential}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ model, messages }),
  };
}

function namesALengthProblem(data) {
  const error = data && data.error ? data.error : {};
  const haystack = `${error.code || ""} ${error.message || ""}`.toLowerCase();
  return (
    LENGTH_MARKERS.some((marker) => haystack.includes(marker)) ||
    SIZE_TARGET_TOO_LONG.test(haystack)
  );
}

// A non-2xx answer, mapped to the kind that describes it. The status and the
// endpoint's wording are read here and go no further than the log.
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
  if (status === 429) {
    return {
      ok: false,
      kind: ErrorKind.PROVIDER_ERROR,
      detail: ProviderErrorDetail.RATE_LIMITED,
      status,
    };
  }
  if (status >= 500) {
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

// The generated text of the first returned choice, trimmed, is the summary.
// One member of the answer is read rather than ignored: a finish_reason of
// "length" says the text stopped at the output limit, and a fragment presented
// as a finished summary is worse than being told the run failed. usage, id and
// every other member are ignored. A body that is not JSON, or JSON without that
// path, is no-usable-summary: a blank panel and a fragment of protocol are
// both worse than being told the run failed.
export function readAnswer(data) {
  const choices = data && Array.isArray(data.choices) ? data.choices : null;
  const first = choices && choices.length ? choices[0] : null;

  if (first && first.finish_reason === "length") {
    return { ok: false, kind: ErrorKind.NO_USABLE_SUMMARY };
  }

  const content = first && first.message ? first.message.content : null;
  if (typeof content !== "string" || content.trim() === "") {
    return { ok: false, kind: ErrorKind.NO_USABLE_SUMMARY };
  }
  return { ok: true, summary: content.trim() };
}

// One call: build the documented request, send it under the common bounded
// wait, and map whatever comes back to a normalized result. No fallback to
// another provider exists here or anywhere else this is called from.
export async function callSakura(
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
