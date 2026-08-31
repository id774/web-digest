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
