import test from "node:test";
import assert from "node:assert/strict";

import {
  SAKURA_BASE_URL,
  buildRequest,
  callSakura,
  mapHttpFailure,
  readAnswer,
} from "../src/engine/sakura.js";

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

function summaryBody(content) {
  return { choices: [{ message: { content } }] };
}

test("the request is the documented one, to one origin", () => {
  const request = buildRequest(CALL);
  assert.equal(request.url, `${SAKURA_BASE_URL}/chat/completions`);
  assert.equal(request.method, "POST");
  assert.equal(request.headers.Authorization, `Bearer ${CALL.credential}`);
  assert.equal(request.headers["Content-Type"], "application/json");
  assert.equal(request.headers.Accept, "application/json");
});

test("the instruction and material become a system and a user message", () => {
  const body = JSON.parse(buildRequest(CALL).body);
  assert.deepEqual(Object.keys(body).sort(), ["messages", "model"]);
  assert.equal(body.model, CALL.model);
  assert.deepEqual(body.messages, [
    { role: "system", content: CALL.instruction },
    { role: "user", content: CALL.content },
  ]);
});

test("the summary is the first choice's content, trimmed", () => {
  assert.deepEqual(readAnswer(summaryBody("  A summary.  ")), {
    ok: true,
    summary: "A summary.",
  });
});

test("an answer with no usable content is not shown as a summary", () => {
  for (const body of [
    null,
    {},
    { choices: [] },
    { choices: [{}] },
    summaryBody(""),
    summaryBody("   "),
    summaryBody(null),
  ]) {
    assert.deepEqual(readAnswer(body), {
      ok: false,
      kind: "no-usable-summary",
    });
  }
});

test("everything else in the answer is ignored rather than interpreted", () => {
  const body = {
    id: "x",
    usage: { total_tokens: 9 },
    choices: [{ finish_reason: "length", message: { content: "Cut short." } }],
  };
  assert.deepEqual(readAnswer(body), { ok: true, summary: "Cut short." });
});

test("the failure mapping table", () => {
  assert.equal(mapHttpFailure(401, null).kind, "credential-rejected");
  assert.equal(mapHttpFailure(403, null).detail, "refused");
  assert.equal(mapHttpFailure(404, null).detail, "refused");
  assert.equal(mapHttpFailure(429, null).detail, "rate-limited");
  assert.equal(mapHttpFailure(500, null).detail, "unavailable");
  assert.equal(mapHttpFailure(503, null).detail, "unavailable");
  assert.equal(mapHttpFailure(418, null).detail, "unspecified");
  for (const status of [403, 404, 429, 500, 418]) {
    assert.equal(mapHttpFailure(status, null).kind, "provider-error");
  }
});

test("a refusal that names a length problem is the too-much-text kind", () => {
  for (const status of [400, 413, 422]) {
    for (const error of [
      { code: "context_length_exceeded" },
      { message: "This model's maximum context is 8192 tokens" },
      { message: "input too long" },
      { message: "Request TOO LARGE" },
    ]) {
      assert.equal(
        mapHttpFailure(status, { error }).kind,
        "too-much-text",
        JSON.stringify(error),
      );
    }
  }
});

test("a refusal worded otherwise falls through rather than being guessed at", () => {
  const mapped = mapHttpFailure(400, { error: { message: "bad request" } });
  assert.equal(mapped.kind, "provider-error");
  assert.equal(mapped.detail, "unspecified");
});

test("a successful call returns the summary and no credential", async () => {
  const result = await callSakura(CALL, {
    fetchImpl: answering(200, summaryBody("A summary.")),
  });
  assert.deepEqual(result, { ok: true, summary: "A summary." });
  assert.ok(!JSON.stringify(result).includes(CALL.credential));
});

test("the call sends what buildRequest built", async () => {
  let seen = null;
  await callSakura(CALL, {
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return (await answering(200, summaryBody("ok"))());
    },
  });
  assert.equal(seen.url, `${SAKURA_BASE_URL}/chat/completions`);
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers.Authorization, `Bearer ${CALL.credential}`);
  assert.ok(seen.init.signal);
});

test("HTTP failures reach the caller as their kind", async () => {
  const cases = [
    [401, "credential-rejected", undefined],
    [429, "provider-error", "rate-limited"],
    [500, "provider-error", "unavailable"],
  ];
  for (const [status, kind, detail] of cases) {
    const result = await callSakura(CALL, {
      fetchImpl: answering(status, { error: { message: "no" } }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.kind, kind);
    if (detail) assert.equal(result.detail, detail);
  }
});

test("a transport failure is provider-unreachable", async () => {
  const result = await callSakura(CALL, {
    fetchImpl: async () => {
      throw new TypeError("network");
    },
  });
  assert.deepEqual(result, { ok: false, kind: "provider-unreachable" });
});

test("the bounded wait ends the run as timeout", async () => {
  const result = await callSakura(CALL, {
    timeoutMs: 20,
    fetchImpl: (url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      }),
  });
  assert.deepEqual(result, { ok: false, kind: "timeout" });
});

test("the bounded wait does not depend on fetch honoring abort", async () => {
  const result = await callSakura(CALL, {
    timeoutMs: 20,
    fetchImpl: () => new Promise(() => {}),
  });
  assert.deepEqual(result, { ok: false, kind: "timeout" });
});

test("a 2xx body that is not JSON is no-usable-summary", async () => {
  const result = await callSakura(CALL, {
    fetchImpl: answering(200, null, { json: false }),
  });
  assert.deepEqual(result, { ok: false, kind: "no-usable-summary" });
});

test("no exception text or response body crosses the boundary", async () => {
  const result = await callSakura(CALL, {
    fetchImpl: answering(500, {
      error: { message: "stack trace and internals" },
    }),
  });
  assert.deepEqual(Object.keys(result).sort(), [
    "detail",
    "kind",
    "ok",
    "status",
  ]);
  assert.ok(!JSON.stringify(result).includes("stack trace"));
});
