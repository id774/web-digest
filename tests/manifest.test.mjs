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

test("OpenAI's, Claude's and Kimi's host permissions are optional, and no other one exists", async () => {
  const manifest = await readManifest();
  assert.deepEqual(
    new Set(manifest.optional_host_permissions),
    new Set([
      "https://api.openai.com/*",
      "https://api.anthropic.com/*",
      "https://api.moonshot.ai/*",
    ]),
  );
  assert.equal(manifest.optional_host_permissions.length, 3);
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

test("diagnostics add no permission, host, script, or dependency", async () => {
  const manifest = await readManifest();
  assert.equal(manifest.version, "1.1.1");
  assert.deepEqual(manifest.permissions, [
    "activeTab",
    "scripting",
    "storage",
    "sidePanel",
  ]);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.permissions.includes("unlimitedStorage"), false);
  const pkg = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
});

test("doc/VERSIONS keeps the unreleased entry's number and records the diagnostics item once", async () => {
  const versions = await readFile(
    new URL("../doc/VERSIONS", import.meta.url),
    "utf8",
  );
  const top = versions.split("\n\n")[1];
  assert.match(top, /^v1\.1\.2 \(Release Date: TBD\)\n-+\n/);
  const bullets = top.split("\n").filter((line) => line.startsWith("- "));
  assert.equal(bullets.length, 5);
  assert.match(bullets[0], /extension icon legibility/);
  assert.match(bullets[1], /up to three Highlights above a clearly separated full Summary/);
  assert.match(
    bullets[2],
    /Added optional, session-only diagnostics with accurate tab-bound state/,
  );
  assert.match(
    top,
    /avoided link-dominated roots and hidden or non-rendered content\./,
  );
  assert.match(bullets[4], /Preserved Unicode characters when dividing long pages/);
  for (const line of top.split("\n")) assert.ok(line.length <= 80, line);
});
