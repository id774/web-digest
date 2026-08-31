import test from "node:test";
import assert from "node:assert/strict";

import { callProvider } from "../src/engine/dispatcher.js";

const LOGICAL_REQUEST = {
  model: "a-model",
  credential: "a-credential",
  instruction: "instruction",
  content: "material",
};

test("sakura is dispatched to the documented Sakura endpoint", async () => {
  let seenUrl = null;
  const result = await callProvider(
    { provider: "sakura", ...LOGICAL_REQUEST },
    {
      fetchImpl: async (url) => {
        seenUrl = url;
        return {
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message: { content: "ok" } }] }),
        };
      },
    },
  );
  assert.equal(seenUrl, "https://api.ai.sakura.ad.jp/v1/chat/completions");
  assert.deepEqual(result, { ok: true, summary: "ok" });
});

test("openai is dispatched to the documented Responses endpoint", async () => {
  let seenUrl = null;
  const result = await callProvider(
    { provider: "openai", ...LOGICAL_REQUEST },
    {
      fetchImpl: async (url) => {
        seenUrl = url;
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: "completed", output_text: "ok" }),
        };
      },
    },
  );
  assert.equal(seenUrl, "https://api.openai.com/v1/responses");
  assert.deepEqual(result, { ok: true, summary: "ok" });
});

test("anthropic is dispatched to the documented Messages endpoint", async () => {
  let seenUrl = null;
  const result = await callProvider(
    { provider: "anthropic", ...LOGICAL_REQUEST },
    {
      fetchImpl: async (url) => {
        seenUrl = url;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            content: [{ type: "text", text: "ok" }],
            stop_reason: "end_turn",
          }),
        };
      },
    },
  );
  assert.equal(seenUrl, "https://api.anthropic.com/v1/messages");
  assert.deepEqual(result, { ok: true, summary: "ok" });
});

test("an unsupported provider is internal-error rather than a guess", async () => {
  const result = await callProvider({ provider: "bogus", ...LOGICAL_REQUEST });
  assert.deepEqual(result, { ok: false, kind: "internal-error" });
});

test("only one adapter is ever called, never a second on failure", async () => {
  let calls = 0;
  const result = await callProvider(
    { provider: "sakura", ...LOGICAL_REQUEST },
    {
      fetchImpl: async () => {
        calls += 1;
        return { ok: false, status: 500, json: async () => null };
      },
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.ok, false);
});
