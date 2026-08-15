// The only module that speaks to the Sakura AI Engine.
//
// Nothing else knows the endpoint, the header, the body or the shape of the
// answer. The token is a parameter: it is never stored here, never logged here
// and never returned from here.

import { ErrorKind, EngineErrorDetail } from "../common/errors.js";

// The service's OpenAI-compatible API base. The official Sakura AI Engine
// documentation is the authority for it; this constant is the one place an
// implementation records what that documentation says. It is not a setting,
// which is what lets the manifest name exactly one origin.
export const ENGINE_BASE_URL = "https://api.ai.sakura.ad.jp/v1";

// Two minutes. A whole page summarized in one non-streaming request is a slow
// request by nature, and a limit short enough to cut a working run would turn
// a succeeding summary into an error the reader cannot act on.
export const REQUEST_TIMEOUT_MS = 120000;

// Matched, not parsed. An endpoint that words its refusal differently falls
// through to engine-error, which is a worse message but never a wrong one.
const LENGTH_MARKERS = [
  "context_length",
  "context length",
  "maximum context",
  "too long",
  "too large",
];

// model and messages are the only members sent. max_tokens and temperature are
// not: a character count is not the constraint and neither is a setting, so
// there is no value for either this design could honestly supply. stream is
// not sent — one request per run, and the answer arrives whole.
export function buildRequest({ model, messages, token }) {
  return {
    url: `${ENGINE_BASE_URL}/chat/completions`,
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ model, messages }),
  };
}

function namesALengthProblem(data) {
  const error = data && data.error ? data.error : {};
  const haystack = `${error.code || ""} ${error.message || ""}`.toLowerCase();
  return LENGTH_MARKERS.some((marker) => haystack.includes(marker));
}

// A non-2xx answer, mapped to the kind that describes it. The status and the
// endpoint's wording are read here and go no further than the log.
export function mapHttpFailure(status, data) {
  if (status === 401) {
    return { ok: false, kind: ErrorKind.TOKEN_REJECTED, status };
  }
  if (
    (status === 400 || status === 413 || status === 422) &&
    namesALengthProblem(data)
  ) {
    return { ok: false, kind: ErrorKind.TOO_MUCH_TEXT, status };
  }
  if (status === 403 || status === 404) {
    return {
      ok: false,
      kind: ErrorKind.ENGINE_ERROR,
      detail: EngineErrorDetail.REFUSED,
      status,
    };
  }
  if (status === 429) {
    return {
      ok: false,
      kind: ErrorKind.ENGINE_ERROR,
      detail: EngineErrorDetail.RATE_LIMITED,
      status,
    };
  }
  if (status >= 500) {
    return {
      ok: false,
      kind: ErrorKind.ENGINE_ERROR,
      detail: EngineErrorDetail.UNAVAILABLE,
      status,
    };
  }
  return {
    ok: false,
    kind: ErrorKind.ENGINE_ERROR,
    detail: EngineErrorDetail.UNSPECIFIED,
    status,
  };
}

// The generated text of the first returned choice, trimmed, is the summary.
// Everything else in the answer is ignored rather than interpreted — including
// finish_reason, usage and id. A body that is not JSON, or JSON without that
// path, is no-usable-summary: a blank panel and a fragment of protocol are
// both worse than being told the run failed.
export function readAnswer(data) {
  const choices = data && Array.isArray(data.choices) ? data.choices : null;
  const first = choices && choices.length ? choices[0] : null;
  const content = first && first.message ? first.message.content : null;
  if (typeof content !== "string" || content.trim() === "") {
    return { ok: false, kind: ErrorKind.NO_USABLE_SUMMARY };
  }
  return { ok: true, summary: content.trim() };
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

// One request, under one bounded wait covering the whole of it including
// reading the body. A failed run is never retried automatically: one click is
// one request, which keeps what the reader's token is spent on visible.
export async function callEngine(
  { model, messages, token },
  { fetchImpl, timeoutMs = REQUEST_TIMEOUT_MS } = {},
) {
  const send = fetchImpl || globalThis.fetch;
  const request = buildRequest({ model, messages, token });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await send(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    });

    const data = await readJson(response);
    if (controller.signal.aborted) {
      return { ok: false, kind: ErrorKind.ENGINE_TIMEOUT };
    }
    if (!response.ok) {
      return mapHttpFailure(response.status, data);
    }
    return readAnswer(data);
  } catch {
    if (controller.signal.aborted) {
      return { ok: false, kind: ErrorKind.ENGINE_TIMEOUT };
    }
    return { ok: false, kind: ErrorKind.ENGINE_UNREACHABLE };
  } finally {
    clearTimeout(timer);
  }
}
