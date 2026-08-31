// The only module that speaks to OpenAI.
//
// Nothing else knows the endpoint, the header, the body or the shape of the
// answer. The credential is a parameter: it is never stored here, never
// logged here and never returned from here.
//
// This uses OpenAI's native Responses API, never the Chat Completions API,
// the Assistants API or a compatibility layer. Every request carries
// `store: false`; no tool, no web or file search, no conversation state and
// no streaming is used.

import { ErrorKind, ProviderErrorDetail } from "../common/errors.js";
import { sendRequest, REQUEST_TIMEOUT_MS } from "./transport.js";

export const OPENAI_BASE_URL = "https://api.openai.com/v1";

// Matched, not parsed. An endpoint that words its refusal differently falls
// through to provider-error, which is a worse message but never a wrong one.
const LENGTH_MARKERS = [
  "context_length",
  "context length",
  "maximum context",
  "too long",
  "too large",
];

// The trusted instruction becomes `instructions`; the material — the page,
// chunk or integration text — becomes `input`. Nothing of this project's own
// protocol is invented: this is the documented shape of a Responses request.
export function buildRequest({ model, instruction, content, credential }) {
  return {
    url: `${OPENAI_BASE_URL}/responses`,
    method: "POST",
    headers: {
      Authorization: `Bearer ${credential}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions: instruction,
      input: content,
      store: false,
    }),
  };
}

function namesALengthProblem(data) {
  const error = data && data.error ? data.error : {};
  const haystack = `${error.code || ""} ${error.message || ""}`.toLowerCase();
  return LENGTH_MARKERS.some((marker) => haystack.includes(marker));
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

// The concatenation of every `output_text` content block of every `message`
// output item, or the convenience `output_text` field when the answer carries
// one. Anything else in the answer — usage, id, reasoning items — is ignored
// rather than interpreted.
function extractOutputText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  const output = Array.isArray(data.output) ? data.output : [];
  const parts = [];
  for (const item of output) {
    if (!item || item.type !== "message" || !Array.isArray(item.content)) {
      continue;
    }
    for (const block of item.content) {
      if (
        block &&
        block.type === "output_text" &&
        typeof block.text === "string"
      ) {
        parts.push(block.text);
      }
    }
  }
  return parts.length ? parts.join("") : null;
}

// A response whose top-level `status` is present and is not `completed` —
// `incomplete`, `failed`, `cancelled` or `queued` — is not shown as a summary,
// whatever text it happens to carry: the run was not the successful,
// complete answer this design accepts. A missing usable text is the same
// no-usable-summary case as an unreadable body.
export function readAnswer(data) {
  if (!data || typeof data !== "object") {
    return { ok: false, kind: ErrorKind.NO_USABLE_SUMMARY };
  }
  if (typeof data.status === "string" && data.status !== "completed") {
    return { ok: false, kind: ErrorKind.NO_USABLE_SUMMARY };
  }
  const text = extractOutputText(data);
  if (typeof text !== "string" || text.trim() === "") {
    return { ok: false, kind: ErrorKind.NO_USABLE_SUMMARY };
  }
  return { ok: true, summary: text.trim() };
}

export async function callOpenAI(
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
