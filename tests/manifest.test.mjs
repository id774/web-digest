import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function readManifest() {
  const text = await readFile(
    new URL("../manifest.json", import.meta.url),
    "utf8",
  );
  return JSON.parse(text);
}

test("the manifest is valid JSON carrying the v1.1.0 version", async () => {
  const manifest = await readManifest();
  assert.equal(manifest.version, "1.1.0");
});

test("Sakura's host permission stays required", async () => {
  const manifest = await readManifest();
  assert.deepEqual(manifest.host_permissions, [
    "https://api.ai.sakura.ad.jp/*",
  ]);
});

test("OpenAI's and Claude's host permissions are optional, and no other one exists", async () => {
  const manifest = await readManifest();
  assert.deepEqual(
    new Set(manifest.optional_host_permissions),
    new Set(["https://api.openai.com/*", "https://api.anthropic.com/*"]),
  );
  assert.equal(manifest.optional_host_permissions.length, 2);
});

test("no unrelated permission was added", async () => {
  const manifest = await readManifest();
  assert.deepEqual(
    new Set(manifest.permissions),
    new Set(["activeTab", "scripting", "storage", "sidePanel"]),
  );
});
