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

test("max_tokens is the fixed 32768 protocol ceiling", () => {
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

test("a truncated or refused response is not shown as a summary", () => {
  for (const stopReason of [
    "max_tokens",
    "refusal",
    "model_context_window_exceeded",
  ]) {
    assert.deepEqual(
      readAnswer(textBody("not a usable summary", stopReason)),
      {
        ok: false,
        kind: "no-usable-summary",
      },
    );
  }
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
  assert.equal(mapHttpFailure(403, null).detail, "unspecified");
  assert.equal(mapHttpFailure(404, null).kind, "provider-error");
  assert.equal(mapHttpFailure(404, null).detail, "refused");
  assert.equal(mapHttpFailure(429, null).detail, "rate-limited");
  assert.equal(mapHttpFailure(500, null).detail, "unavailable");
  assert.equal(mapHttpFailure(529, null).detail, "unavailable");
  assert.equal(
    mapHttpFailure(400, { error: { message: "prompt is too long" } }).kind,
    "too-much-text",
  );
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
