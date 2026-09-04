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

async function readDetailedDesign() {
  return await readFile(
    new URL("../doc/DETAILED_DESIGN.md", import.meta.url),
    "utf8",
  );
}

test("the manifest is valid JSON carrying the v1.1.1 version", async () => {
  const manifest = await readManifest();
  assert.equal(manifest.version, "1.1.1");
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

test("doc/DETAILED_DESIGN.md's manifest example carries the same version as manifest.json", async () => {
  const manifest = await readManifest();
  const detailedDesign = await readDetailedDesign();

  assert.match(
    detailedDesign,
    new RegExp(`"version":\\s*"${manifest.version}"`),
    `doc/DETAILED_DESIGN.md's manifest example must say version ${manifest.version}`,
  );
  assert.doesNotMatch(
    detailedDesign,
    /"version":\s*"1\.1\.0"/,
    "doc/DETAILED_DESIGN.md must not still show the stale 1.1.0 manifest version",
  );
});
