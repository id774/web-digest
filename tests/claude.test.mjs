import test from "node:test";
import assert from "node:assert/strict";

import {
  ANTHROPIC_BASE_URL,
  ANTHROPIC_VERSION,
  MAX_OUTPUT_TOKENS,
  buildRequest,
  callClaude,
  mapHttpFailure,
  readAnswer,
} from "../src/engine/claude.js";

const CALL = {
  model: "a-model",
  instruction: "instruction",
  content: "material",
  credential: "test-credential-value",
};

function answering(status, body, { json = true } = {}) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (!json) throw new SyntaxError("not JSON");
      return body;
    },
  });
}

function textBody(text, stopReason = "end_turn") {
  return { content: [{ type: "text", text }], stop_reason: stopReason };
}

test("the request is the documented Messages call, to one origin", () => {
  const request = buildRequest(CALL);
  assert.equal(request.url, `${ANTHROPIC_BASE_URL}/messages`);
  assert.equal(request.method, "POST");
  assert.equal(request.headers["x-api-key"], CALL.credential);
  assert.equal(request.headers["anthropic-version"], ANTHROPIC_VERSION);
  assert.equal(request.headers["Content-Type"], "application/json");
  assert.equal(Object.prototype.hasOwnProperty.call(request.headers, "Authorization"), false);
});

test("the instruction becomes the top-level system and the material a user message", () => {
  const body = JSON.parse(buildRequest(CALL).body);
  assert.equal(body.model, CALL.model);
  assert.equal(body.system, CALL.instruction);
  assert.deepEqual(body.messages, [{ role: "user", content: CALL.content }]);
});

test("max_tokens is this extension's fixed request-level output limit of 32768", () => {
  const body = JSON.parse(buildRequest(CALL).body);
  assert.equal(MAX_OUTPUT_TOKENS, 32768);
  assert.equal(body.max_tokens, 32768);
  assert.equal(
    Object.prototype.hasOwnProperty.call(body, "thinking"),
    false,
  );
});

test("no tool, caching, service tier or stream field is sent", () => {
  const body = JSON.parse(buildRequest(CALL).body);
  for (const field of [
    "thinking",
    "tools",
    "tool_choice",
    "service_tier",
    "stream",
    "temperature",
    "top_p",
    "top_k",
  ]) {
    assert.equal(Object.prototype.hasOwnProperty.call(body, field), false);
  }
});

test("the text blocks joined and trimmed are the summary", () => {
  assert.deepEqual(readAnswer(textBody("  A summary.  ")), {
    ok: true,
    summary: "A summary.",
  });
});

test("several text blocks are concatenated", () => {
  const data = {
    content: [
      { type: "text", text: "Part one. " },
      { type: "text", text: "Part two." },
    ],
    stop_reason: "end_turn",
  };
  assert.deepEqual(readAnswer(data), {
    ok: true,
    summary: "Part one. Part two.",
  });
});

test("a truncated response is not shown as a summary", () => {
  for (const stopReason of ["max_tokens", "model_context_window_exceeded"]) {
    assert.deepEqual(
      readAnswer(textBody("not a usable summary", stopReason)),
      {
        ok: false,
        kind: "no-usable-summary",
      },
    );
  }
});

test("stop_reason refusal is a distinct provider refusal, not success or no-usable-summary", () => {
  const result = readAnswer(textBody("I can't help with that.", "refusal"));
  assert.equal(result.ok, false);
  assert.equal(result.kind, "provider-error");
  assert.equal(result.detail, "provider-refusal");
});

test("refusal text is not displayed as a successful summary even with a text block", () => {
  const data = {
    content: [{ type: "text", text: "declined text" }],
    stop_reason: "refusal",
  };
  const result = readAnswer(data);
  assert.notEqual(result.ok, true);
  assert.equal(result.detail, "provider-refusal");
});

test("a response with no text block is no-usable-summary", () => {
  for (const body of [
    null,
    {},
    { content: [] },
    { content: [{ type: "tool_use" }] },
    { content: [{ type: "text", text: "" }] },
  ]) {
    assert.deepEqual(readAnswer(body), {
      ok: false,
      kind: "no-usable-summary",
    });
  }
});

test("the failure mapping table", () => {
  assert.equal(mapHttpFailure(401, null).kind, "credential-rejected");
  assert.equal(mapHttpFailure(403, null).kind, "provider-error");
  assert.equal(mapHttpFailure(403, null).detail, "access-denied");
  assert.notEqual(mapHttpFailure(403, null).kind, "permission-missing");
  assert.equal(mapHttpFailure(404, null).kind, "provider-error");
  assert.equal(mapHttpFailure(404, null).detail, "refused");
  assert.equal(mapHttpFailure(429, null).detail, "rate-limited");
  assert.equal(mapHttpFailure(500, null).detail, "unavailable");
  assert.equal(mapHttpFailure(529, null).detail, "unavailable");
  assert.equal(
    mapHttpFailure(400, { error: { message: "prompt is too long" } }).kind,
    "too-much-text",
  );
  assert.equal(
    mapHttpFailure(413, { error: { type: "request_too_large" } }).kind,
    "too-much-text",
  );
});

test("HTTP 402 is billing_error, mapped to account-limit", () => {
  const mapped = mapHttpFailure(402, { error: { type: "billing_error" } });
  assert.equal(mapped.kind, "provider-error");
  assert.equal(mapped.detail, "account-limit");
});

test("HTTP 402 is account-limit even with no body", () => {
  const mapped = mapHttpFailure(402, null);
  assert.equal(mapped.kind, "provider-error");
  assert.equal(mapped.detail, "account-limit");
});

test("HTTP 504 is timeout_error, mapped to timeout rather than unavailable", () => {
  const mapped = mapHttpFailure(504, { error: { type: "timeout_error" } });
  assert.equal(mapped.kind, "timeout");
  assert.notEqual(mapped.detail, "unavailable");
});

test("529 overloaded and ordinary 5xx (other than 504) remain unavailable", () => {
  assert.equal(mapHttpFailure(529, null).kind, "provider-error");
  assert.equal(mapHttpFailure(529, null).detail, "unavailable");
  assert.equal(mapHttpFailure(500, null).detail, "unavailable");
  assert.equal(mapHttpFailure(503, null).detail, "unavailable");
});

test("an unrelated validation error naming 'too long' or 'too large' is not too-much-text", () => {
  for (const status of [400, 413, 422]) {
    for (const error of [
      { message: "model name is too long" },
      { message: "header value is too large" },
      { message: "identifier is too long" },
      { message: "parameter value is too large" },
    ]) {
      const mapped = mapHttpFailure(status, { error });
      assert.notEqual(mapped.kind, "too-much-text", JSON.stringify(error));
    }
  }
});

test("a free-form message naming a size target is still too-much-text", () => {
  const mapped = mapHttpFailure(400, { error: { message: "input too long" } });
  assert.equal(mapped.kind, "too-much-text");
});

test("a call that receives HTTP 504 ends the run as timeout", async () => {
  const result = await callClaude(CALL, {
    fetchImpl: answering(504, { error: { type: "timeout_error" } }),
  });
  assert.equal(result.kind, "timeout");
});

test("a call that receives HTTP 402 ends the run as provider-error/account-limit", async () => {
  const result = await callClaude(CALL, {
    fetchImpl: answering(402, { error: { type: "billing_error" } }),
  });
  assert.equal(result.kind, "provider-error");
  assert.equal(result.detail, "account-limit");
});

test("a call that receives HTTP 403 ends the run as provider-error/access-denied, not permission-missing", async () => {
  const result = await callClaude(CALL, {
    fetchImpl: answering(403, { error: { type: "permission_error" } }),
  });
  assert.equal(result.kind, "provider-error");
  assert.equal(result.detail, "access-denied");
  assert.notEqual(result.kind, "permission-missing");
});

test("a call whose response has stop_reason refusal is not a success", async () => {
  const result = await callClaude(CALL, {
    fetchImpl: answering(200, textBody("declined", "refusal")),
  });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "provider-error");
  assert.equal(result.detail, "provider-refusal");
});

test("a successful call returns the summary and no credential", async () => {
  const result = await callClaude(CALL, {
    fetchImpl: answering(200, textBody("A summary.")),
  });
  assert.deepEqual(result, { ok: true, summary: "A summary." });
  assert.ok(!JSON.stringify(result).includes(CALL.credential));
});

test("the call sends what buildRequest built", async () => {
  let seen = null;
  await callClaude(CALL, {
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return (await answering(200, textBody("ok"))());
    },
  });
  assert.equal(seen.url, `${ANTHROPIC_BASE_URL}/messages`);
  assert.equal(seen.init.headers["x-api-key"], CALL.credential);
});

test("HTTP failures reach the caller as their kind", async () => {
  const result = await callClaude(CALL, {
    fetchImpl: answering(401, { error: { message: "bad key" } }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "credential-rejected");
});

test("a transport failure is provider-unreachable", async () => {
  const result = await callClaude(CALL, {
    fetchImpl: async () => {
      throw new TypeError("network");
    },
  });
  assert.deepEqual(result, { ok: false, kind: "provider-unreachable" });
});

test("the bounded wait ends the run as timeout", async () => {
  const result = await callClaude(CALL, {
    timeoutMs: 20,
    fetchImpl: () => new Promise(() => {}),
  });
  assert.deepEqual(result, { ok: false, kind: "timeout" });
});
