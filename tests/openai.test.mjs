import test from "node:test";
import assert from "node:assert/strict";

import {
  OPENAI_BASE_URL,
  buildRequest,
  callOpenAI,
  mapHttpFailure,
  readAnswer,
} from "../src/engine/openai.js";

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

function completedBody(text) {
  return {
    status: "completed",
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text }],
      },
    ],
  };
}

test("the request is the documented Responses call, to one origin", () => {
  const request = buildRequest(CALL);
  assert.equal(request.url, `${OPENAI_BASE_URL}/responses`);
  assert.equal(request.method, "POST");
  assert.equal(request.headers.Authorization, `Bearer ${CALL.credential}`);
  assert.equal(request.headers["Content-Type"], "application/json");
});

test("the instruction becomes instructions and the material becomes input", () => {
  const body = JSON.parse(buildRequest(CALL).body);
  assert.equal(body.model, CALL.model);
  assert.equal(body.instructions, CALL.instruction);
  assert.equal(body.input, CALL.content);
});

test("store is always false, and no tool, conversation or stream field is sent", () => {
  const body = JSON.parse(buildRequest(CALL).body);
  assert.equal(body.store, false);
  for (const field of [
    "tools",
    "conversation",
    "previous_response_id",
    "background",
    "stream",
  ]) {
    assert.equal(Object.prototype.hasOwnProperty.call(body, field), false);
  }
});

test("usable text from output_text blocks is the summary", () => {
  assert.deepEqual(readAnswer(completedBody("  A summary.  ")), {
    ok: true,
    summary: "A summary.",
  });
});

test("the output_text convenience field is used when present", () => {
  assert.deepEqual(
    readAnswer({ status: "completed", output_text: " A summary. " }),
    { ok: true, summary: "A summary." },
  );
});

test("an incomplete or non-completed response is not shown as a summary", () => {
  for (const status of ["incomplete", "failed", "cancelled", "queued"]) {
    assert.deepEqual(readAnswer({ status, output_text: "partial" }), {
      ok: false,
      kind: "no-usable-summary",
    });
  }
});

test("a response with no usable text is no-usable-summary", () => {
  for (const body of [
    null,
    {},
    { status: "completed" },
    { status: "completed", output: [] },
    { status: "completed", output_text: "" },
    { status: "completed", output_text: "   " },
  ]) {
    assert.deepEqual(readAnswer(body), {
      ok: false,
      kind: "no-usable-summary",
    });
  }
});

test("the failure mapping table", () => {
  assert.equal(mapHttpFailure(401, null).kind, "credential-rejected");
  assert.equal(mapHttpFailure(429, null).detail, "rate-limited");
  assert.equal(mapHttpFailure(500, null).detail, "unavailable");
  assert.equal(
    mapHttpFailure(400, { error: { code: "context_length_exceeded" } }).kind,
    "too-much-text",
  );
  assert.equal(mapHttpFailure(403, null).detail, "unspecified");
  assert.equal(mapHttpFailure(404, null).detail, "refused");
});

test("a documented account-limit 429 error.code is account-limit, not rate-limited", () => {
  for (const code of [
    "credit_balance_exhausted",
    "organization_usage_limit_exceeded",
    "organization_spend_limit_exceeded",
    "project_spend_limit_exceeded",
  ]) {
    const mapped = mapHttpFailure(429, { error: { code } });
    assert.equal(mapped.kind, "provider-error", code);
    assert.equal(mapped.detail, "account-limit", code);
  }
});

test("a 429 with error.type=insufficient_quota is account-limit", () => {
  const mapped = mapHttpFailure(429, {
    error: { type: "insufficient_quota" },
  });
  assert.equal(mapped.detail, "account-limit");
});

test("an ordinary or unknown 429 stays rate-limited, never guessed as account-limit", () => {
  for (const body of [
    null,
    {},
    { error: {} },
    { error: { code: "rate_limit_exceeded" } },
    { error: { type: "requests" } },
    { error: { message: "You are sending requests too quickly." } },
  ]) {
    const mapped = mapHttpFailure(429, body);
    assert.equal(mapped.detail, "rate-limited", JSON.stringify(body));
  }
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
  for (const status of [400, 413, 422]) {
    for (const error of [
      { message: "input too long" },
      { message: "the request is too large" },
      { message: "This model's maximum context is 8192 tokens" },
    ]) {
      assert.equal(
        mapHttpFailure(status, { error }).kind,
        "too-much-text",
        JSON.stringify(error),
      );
    }
  }
});

test("a successful call returns the summary and no credential", async () => {
  const result = await callOpenAI(CALL, {
    fetchImpl: answering(200, completedBody("A summary.")),
  });
  assert.deepEqual(result, { ok: true, summary: "A summary." });
  assert.ok(!JSON.stringify(result).includes(CALL.credential));
});

test("HTTP failures reach the caller as their kind", async () => {
  const result = await callOpenAI(CALL, {
    fetchImpl: answering(401, { error: { message: "bad key" } }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "credential-rejected");
});

test("a transport failure is provider-unreachable", async () => {
  const result = await callOpenAI(CALL, {
    fetchImpl: async () => {
      throw new TypeError("network");
    },
  });
  assert.deepEqual(result, { ok: false, kind: "provider-unreachable" });
});

test("the bounded wait ends the run as timeout", async () => {
  const result = await callOpenAI(CALL, {
    timeoutMs: 20,
    fetchImpl: () => new Promise(() => {}),
  });
  assert.deepEqual(result, { ok: false, kind: "timeout" });
});

test("an incomplete response from the network is not a success", async () => {
  const result = await callOpenAI(CALL, {
    fetchImpl: answering(200, { status: "incomplete", output_text: "cut" }),
  });
  assert.deepEqual(result, { ok: false, kind: "no-usable-summary" });
});
