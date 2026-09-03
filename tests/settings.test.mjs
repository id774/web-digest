import test from "node:test";
import assert from "node:assert/strict";

import { readFile } from "node:fs/promises";

import {
  ANTHROPIC_DEFAULT_MODEL,
  DEFAULT_MODEL,
  OPENAI_DEFAULT_MODEL,
  Provider,
  STORAGE_KEY_ANTHROPIC_KEY,
  STORAGE_KEY_ANTHROPIC_MODEL,
  STORAGE_KEY_JAPANESE_SUMMARY,
  STORAGE_KEY_MODEL,
  STORAGE_KEY_OPENAI_KEY,
  STORAGE_KEY_OPENAI_MODEL,
  STORAGE_KEY_PROVIDER,
  STORAGE_KEY_TOKEN,
  isCredentialSet,
  resolveJapaneseSummary,
  resolveModel,
  resolveModelFor,
  resolveProvider,
} from "../src/common/settings.js";
import { validateCredential, validateModel } from "../src/options/options.js";
import {
  ErrorKind,
  ProviderErrorDetail,
  messageFor,
} from "../src/common/errors.js";

test("a credential is unset when absent, not a string, or blank", () => {
  assert.equal(isCredentialSet("a-credential"), true);
  assert.equal(isCredentialSet("  a-credential  "), true);
  assert.equal(isCredentialSet(""), false);
  assert.equal(isCredentialSet("   "), false);
  assert.equal(isCredentialSet(undefined), false);
  assert.equal(isCredentialSet(null), false);
  assert.equal(isCredentialSet(42), false);
});

test("an unknown, invalid or absent provider resolves to Sakura", () => {
  assert.equal(resolveProvider(undefined), Provider.SAKURA);
  assert.equal(resolveProvider(null), Provider.SAKURA);
  assert.equal(resolveProvider(""), Provider.SAKURA);
  assert.equal(resolveProvider("bogus"), Provider.SAKURA);
  assert.equal(resolveProvider(42), Provider.SAKURA);
  assert.equal(resolveProvider(Provider.SAKURA), Provider.SAKURA);
  assert.equal(resolveProvider(Provider.OPENAI), Provider.OPENAI);
  assert.equal(resolveProvider(Provider.ANTHROPIC), Provider.ANTHROPIC);
});

test("an unset model resolves to that provider's own default", () => {
  assert.equal(resolveModelFor(Provider.SAKURA, ""), DEFAULT_MODEL);
  assert.equal(resolveModelFor(Provider.OPENAI, ""), OPENAI_DEFAULT_MODEL);
  assert.equal(
    resolveModelFor(Provider.ANTHROPIC, ""),
    ANTHROPIC_DEFAULT_MODEL,
  );
  assert.equal(
    resolveModelFor(Provider.OPENAI, "  another-model  "),
    "another-model",
  );
});

test("the backward-compatible resolveModel resolves the Sakura default", () => {
  assert.equal(resolveModel(""), DEFAULT_MODEL);
  assert.equal(resolveModel("   "), DEFAULT_MODEL);
  assert.equal(resolveModel(undefined), DEFAULT_MODEL);
  assert.equal(resolveModel("another-model"), "another-model");
});

test("the three default models are each one non-empty string", () => {
  for (const model of [DEFAULT_MODEL, OPENAI_DEFAULT_MODEL, ANTHROPIC_DEFAULT_MODEL]) {
    assert.equal(typeof model, "string");
    assert.notEqual(model.trim(), "");
  }
  assert.equal(new Set([DEFAULT_MODEL, OPENAI_DEFAULT_MODEL, ANTHROPIC_DEFAULT_MODEL]).size, 3);
});

test("the storage keys are the ones the design fixed", () => {
  assert.equal(STORAGE_KEY_PROVIDER, "provider");
  assert.equal(STORAGE_KEY_TOKEN, "apiToken");
  assert.equal(STORAGE_KEY_MODEL, "model");
  assert.equal(STORAGE_KEY_OPENAI_KEY, "openaiApiKey");
  assert.equal(STORAGE_KEY_OPENAI_MODEL, "openaiModel");
  assert.equal(STORAGE_KEY_ANTHROPIC_KEY, "anthropicApiKey");
  assert.equal(STORAGE_KEY_ANTHROPIC_MODEL, "anthropicModel");
  assert.equal(STORAGE_KEY_JAPANESE_SUMMARY, "japaneseSummary");
});

test("Japanese summary is off unless the stored value is exactly true", () => {
  assert.equal(resolveJapaneseSummary(true), true);
  assert.equal(resolveJapaneseSummary(false), false);
  assert.equal(resolveJapaneseSummary(undefined), false);
  assert.equal(resolveJapaneseSummary(null), false);
  assert.equal(resolveJapaneseSummary("true"), false);
  assert.equal(resolveJapaneseSummary(1), false);
  assert.equal(resolveJapaneseSummary({}), false);
});

test("saving or deleting a provider's credential never touches the Japanese summary preference or the provider selection", async () => {
  const source = await readFile(
    new URL("../src/common/settings.js", import.meta.url),
    "utf8",
  );
  const saveSettingsBody = source.match(
    /export async function saveProviderSettings\([^)]*\) \{([\s\S]*?)\n\}/,
  );
  const deleteTokenBody = source.match(
    /export async function deleteCredential\([^)]*\) \{([\s\S]*?)\n\}/,
  );
  assert.ok(saveSettingsBody, "expected to find saveProviderSettings");
  assert.ok(deleteTokenBody, "expected to find deleteCredential");
  assert.doesNotMatch(saveSettingsBody[1], /STORAGE_KEY_JAPANESE_SUMMARY/);
  assert.doesNotMatch(saveSettingsBody[1], /STORAGE_KEY_PROVIDER\b/);
  assert.doesNotMatch(deleteTokenBody[1], /STORAGE_KEY_JAPANESE_SUMMARY/);
  assert.doesNotMatch(deleteTokenBody[1], /STORAGE_KEY_PROVIDER\b/);
});

test("saving a provider's settings never writes another provider's storage key", async () => {
  const source = await readFile(
    new URL("../src/common/settings.js", import.meta.url),
    "utf8",
  );
  const saveSettingsBody = source.match(
    /export async function saveProviderSettings\([^)]*\) \{([\s\S]*?)\n\}/,
  )[1];
  // The function must address its keys through the per-provider lookup
  // tables rather than naming one provider's key literally.
  for (const literalKey of [
    "STORAGE_KEY_TOKEN",
    "STORAGE_KEY_MODEL",
    "STORAGE_KEY_OPENAI_KEY",
    "STORAGE_KEY_OPENAI_MODEL",
    "STORAGE_KEY_ANTHROPIC_KEY",
    "STORAGE_KEY_ANTHROPIC_MODEL",
  ]) {
    assert.doesNotMatch(saveSettingsBody, new RegExp(literalKey));
  }
});

test("the provider preference has its own save function", async () => {
  const source = await readFile(
    new URL("../src/common/settings.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /export async function saveProvider\(/);
  assert.match(source, /export async function readStoredProvider\(/);
});

test("the Japanese summary preference has its own save function", async () => {
  const source = await readFile(
    new URL("../src/common/settings.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /export async function saveJapaneseSummary\(/);
  assert.match(source, /export async function readJapaneseSummary\(/);
});

test("an empty credential is refused rather than treated as a deletion", () => {
  assert.deepEqual(validateCredential("   "), {
    ok: false,
    message: "Enter a credential.",
  });
});

test("a credential carrying whitespace is refused", () => {
  for (const value of ["two words", "line\nbreak", "tab\there"]) {
    const result = validateCredential(value);
    assert.equal(result.ok, false);
    assert.equal(
      result.message,
      "A credential contains no spaces or line breaks.",
    );
  }
});

test("a credential is trimmed on the way in", () => {
  assert.deepEqual(validateCredential("  a-credential  "), {
    ok: true,
    value: "a-credential",
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
    if (kind === ErrorKind.PROVIDER_ERROR) continue;
    const message = messageFor(kind);
    assert.equal(typeof message, "string");
    assert.notEqual(message.trim(), "");
  }
  assert.equal(
    messageFor(ErrorKind.TOO_MUCH_TEXT),
    "This page is too large to process.",
  );
});

test("each provider-error detail has its own message", () => {
  const messages = Object.values(ProviderErrorDetail).map((detail) =>
    messageFor(ErrorKind.PROVIDER_ERROR, detail),
  );
  assert.equal(new Set(messages).size, messages.length);
});

test("the account-limit detail has the exact billing/usage-limit message", () => {
  assert.equal(
    messageFor(ErrorKind.PROVIDER_ERROR, ProviderErrorDetail.ACCOUNT_LIMIT),
    "The selected AI provider reported a billing or usage-limit problem. Check the provider account's billing and usage limits.",
  );
});

test("no credential and credential rejected stay distinguishable", () => {
  assert.notEqual(
    messageFor(ErrorKind.CREDENTIAL_MISSING),
    messageFor(ErrorKind.CREDENTIAL_REJECTED),
  );
});

test("messages are provider-neutral: no provider is named", () => {
  const named = /\bSakura\b|\bOpenAI\b|\bClaude\b|\bAnthropic\b/i;
  for (const kind of Object.values(ErrorKind)) {
    for (const detail of [undefined, ...Object.values(ProviderErrorDetail)]) {
      assert.ok(!named.test(messageFor(kind, detail)), `${kind}/${detail}`);
    }
  }
});

test("a message carries no status, no body and no internals", () => {
  const suspicious = /\b\d{3}\b|Bearer|http|stack|undefined|\[object/i;
  for (const kind of Object.values(ErrorKind)) {
    for (const detail of [undefined, ...Object.values(ProviderErrorDetail)]) {
      assert.ok(
        !suspicious.test(messageFor(kind, detail)),
        `${kind}/${detail}`,
      );
    }
  }
});
