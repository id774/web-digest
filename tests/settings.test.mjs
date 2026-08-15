import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_MODEL,
  STORAGE_KEY_MODEL,
  STORAGE_KEY_TOKEN,
  isTokenSet,
  resolveModel,
} from "../src/common/settings.js";
import { validateModel, validateToken } from "../src/options/options.js";
import {
  EngineErrorDetail,
  ErrorKind,
  messageFor,
} from "../src/common/errors.js";

test("a token is unset when absent, not a string, or blank", () => {
  assert.equal(isTokenSet("a-token"), true);
  assert.equal(isTokenSet("  a-token  "), true);
  assert.equal(isTokenSet(""), false);
  assert.equal(isTokenSet("   "), false);
  assert.equal(isTokenSet(undefined), false);
  assert.equal(isTokenSet(null), false);
  assert.equal(isTokenSet(42), false);
});

test("an unset model is the default", () => {
  assert.equal(resolveModel(""), DEFAULT_MODEL);
  assert.equal(resolveModel("   "), DEFAULT_MODEL);
  assert.equal(resolveModel(undefined), DEFAULT_MODEL);
  assert.equal(resolveModel("another-model"), "another-model");
  assert.equal(resolveModel("  another-model  "), "another-model");
});

test("the model name lives in one place", () => {
  assert.equal(typeof DEFAULT_MODEL, "string");
  assert.notEqual(DEFAULT_MODEL.trim(), "");
});

test("the storage keys are the ones the design fixed", () => {
  assert.equal(STORAGE_KEY_TOKEN, "apiToken");
  assert.equal(STORAGE_KEY_MODEL, "model");
});

test("an empty token is refused rather than treated as a deletion", () => {
  assert.deepEqual(validateToken("   "), {
    ok: false,
    message: "Enter a token.",
  });
});

test("a token carrying whitespace is refused", () => {
  for (const value of ["two words", "line\nbreak", "tab\there"]) {
    const result = validateToken(value);
    assert.equal(result.ok, false);
    assert.equal(result.message, "A token contains no spaces or line breaks.");
  }
});

test("a token is trimmed on the way in", () => {
  assert.deepEqual(validateToken("  a-token  "), {
    ok: true,
    value: "a-token",
  });
});

test("an empty model is allowed and means the default", () => {
  assert.deepEqual(validateModel("  "), { ok: true, value: "" });
});

test("a model name carrying whitespace is refused", () => {
  const result = validateModel("two words");
  assert.equal(result.ok, false);
  assert.equal(result.message, "A model name contains no spaces.");
});

test("every error kind has a message the reader can act on", () => {
  for (const kind of Object.values(ErrorKind)) {
    if (kind === ErrorKind.ENGINE_ERROR) continue;
    const message = messageFor(kind);
    assert.equal(typeof message, "string");
    assert.notEqual(message.trim(), "");
  }
});

test("each engine-error detail has its own message", () => {
  const messages = Object.values(EngineErrorDetail).map((detail) =>
    messageFor(ErrorKind.ENGINE_ERROR, detail),
  );
  assert.equal(new Set(messages).size, messages.length);
});

test("no token and token refused stay distinguishable", () => {
  assert.notEqual(
    messageFor(ErrorKind.TOKEN_MISSING),
    messageFor(ErrorKind.TOKEN_REJECTED),
  );
});

test("a message carries no status, no body and no internals", () => {
  const suspicious = /\b\d{3}\b|Bearer|http|stack|undefined|\[object/i;
  for (const kind of Object.values(ErrorKind)) {
    for (const detail of [undefined, ...Object.values(EngineErrorDetail)]) {
      assert.ok(
        !suspicious.test(messageFor(kind, detail)),
        `${kind}/${detail}`,
      );
    }
  }
});
