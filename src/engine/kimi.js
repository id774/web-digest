// The only module that speaks to Kimi (Moonshot AI).
//
// Nothing else knows the endpoint, the header, the body or the shape of the
// answer. The credential is a parameter: it is never stored here, never
// logged here and never returned from here.
//
// Kimi's protocol is OpenAI-compatible Chat Completions, the same shape
// Sakura AI Engine's adapter already speaks, but Kimi is implemented as its
// own independent adapter rather than folded into another provider's: each
// provider's origin, credential and model stay its own.
//
// Kimi may return a `reasoning_content` field alongside the answer's
// `message.content`. It is never read, never logged and never included in a
// summary: only `message.content` is ever used, and only once `finish_reason`
// confirms the documented normal-completion marker.

import { ErrorKind, ProviderErrorDetail } from "../common/errors.js";
import { sendRequest, REQUEST_TIMEOUT_MS } from "./transport.js";

// The service's OpenAI-compatible API base. The official Moonshot AI
// documentation is the authority for it; this constant is the one place an
// implementation records what that documentation says. It is not a setting,
// which is what lets the manifest name exactly this one optional origin for
// it.
export const KIMI_BASE_URL = "https://api.moonshot.ai/v1";

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

// model and messages are the only members sent. Kimi K3's own documented
// fixed sampling parameters — temperature, top_p, n, presence_penalty,
// frequency_penalty — are not sent, and neither are reasoning_effort, stream,
// tools or tool_choice: none of them is a setting this design offers, and
// this adapter invents no value for any of them.
export function buildRequest({ model, instruction, content, credential }) {
  const messages = [
    { role: "system", content: instruction },
    { role: "user", content },
  ];
  return {
    url: `${KIMI_BASE_URL}/chat/completions`,
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
// endpoint's wording are read here and go no further than the log. Kimi's
// current official documentation does not establish a distinct meaning for
// HTTP 403 or 404 beyond an ordinary provider error, so — matching how
// Sakura's own undocumented statuses are treated — both keep the generic
// `unspecified` mapping rather than being guessed at.
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

// The generated text of the first returned choice, trimmed, is the summary —
// but only once the first choice's own `finish_reason` confirms the
// documented normal-completion marker, `"stop"`. A missing, unknown, or
// otherwise non-"stop" reason carries no usable summary even when it carries
// non-empty text: a fragment presented as a finished summary is worse than
// being told the run failed. `message.reasoning_content`, when present, is
// never read here and never reaches the summary: `message.content` is the
// only field this design ever treats as the answer. A body that is not JSON,
// or JSON without a usable choice, is the same no-usable-summary case.
export function readAnswer(data) {
  const choices = data && Array.isArray(data.choices) ? data.choices : null;
  const first = choices && choices.length ? choices[0] : null;

  if (!first || first.finish_reason !== "stop") {
    return { ok: false, kind: ErrorKind.NO_USABLE_SUMMARY };
  }

  const content = first.message ? first.message.content : null;
  if (typeof content !== "string" || content.trim() === "") {
    return { ok: false, kind: ErrorKind.NO_USABLE_SUMMARY };
  }
  return { ok: true, summary: content.trim() };
}

// One call: build the documented request, send it under the common bounded
// wait, and map whatever comes back to a normalized result. No fallback to
// another provider exists here or anywhere else this is called from.
export async function callKimi(
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
