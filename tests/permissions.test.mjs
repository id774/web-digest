import test from "node:test";
import assert from "node:assert/strict";

import {
  PROVIDER_HOST_PERMISSION,
  hasProviderPermission,
  needsOptionalPermission,
  requestProviderPermission,
} from "../src/common/permissions.js";
import { Provider } from "../src/common/settings.js";
import { changeProvider } from "../src/options/options.js";

test("Sakura needs no optional permission", () => {
  assert.equal(needsOptionalPermission(Provider.SAKURA), false);
});

test("OpenAI and Claude each need their own optional permission", () => {
  assert.equal(needsOptionalPermission(Provider.OPENAI), true);
  assert.equal(needsOptionalPermission(Provider.ANTHROPIC), true);
  assert.equal(
    PROVIDER_HOST_PERMISSION[Provider.OPENAI],
    "https://api.openai.com/*",
  );
  assert.equal(
    PROVIDER_HOST_PERMISSION[Provider.ANTHROPIC],
    "https://api.anthropic.com/*",
  );
});

test("Sakura is always reported as permitted, without asking the browser", async () => {
  const permissionsApi = {
    contains: async () => {
      throw new Error("must not be called for Sakura");
    },
  };
  assert.equal(
    await hasProviderPermission(Provider.SAKURA, permissionsApi),
    true,
  );
});

test("an optional-permission provider is checked with chrome.permissions.contains", async () => {
  const seen = [];
  const permissionsApi = {
    contains: async (query) => {
      seen.push(query);
      return true;
    },
  };
  const granted = await hasProviderPermission(Provider.OPENAI, permissionsApi);
  assert.equal(granted, true);
  assert.deepEqual(seen, [{ origins: ["https://api.openai.com/*"] }]);
});

test("requesting does not prompt again once already granted", async () => {
  let requestCalls = 0;
  const permissionsApi = {
    contains: async () => true,
    request: async () => {
      requestCalls += 1;
      return true;
    },
  };
  const granted = await requestProviderPermission(
    Provider.ANTHROPIC,
    permissionsApi,
  );
  assert.equal(granted, true);
  assert.equal(requestCalls, 0);
});

test("requesting prompts only when not already granted", async () => {
  let requestCalls = 0;
  const permissionsApi = {
    contains: async () => false,
    request: async () => {
      requestCalls += 1;
      return true;
    },
  };
  const granted = await requestProviderPermission(
    Provider.OPENAI,
    permissionsApi,
  );
  assert.equal(granted, true);
  assert.equal(requestCalls, 1);
});

test("changeProvider saves the provider once permission is granted", async () => {
  let saved = null;
  const result = await changeProvider({
    provider: Provider.OPENAI,
    requestPermission: async () => true,
    save: async (provider) => {
      saved = provider;
    },
  });
  assert.deepEqual(result, { ok: true, provider: Provider.OPENAI });
  assert.equal(saved, Provider.OPENAI);
});

test("changeProvider does not save the provider when permission is denied", async () => {
  let saveCalls = 0;
  const result = await changeProvider({
    provider: Provider.ANTHROPIC,
    requestPermission: async () => false,
    save: async () => {
      saveCalls += 1;
    },
  });
  assert.deepEqual(result, { ok: false, provider: Provider.ANTHROPIC });
  assert.equal(saveCalls, 0);
});

test("changeProvider never requests a permission for Sakura", async () => {
  let saved = null;
  let requestCalls = 0;
  const result = await changeProvider({
    provider: Provider.SAKURA,
    requestPermission: async () => {
      requestCalls += 1;
      return true;
    },
    save: async (provider) => {
      saved = provider;
    },
  });
  assert.deepEqual(result, { ok: true, provider: Provider.SAKURA });
  assert.equal(requestCalls, 0);
  assert.equal(saved, Provider.SAKURA);
});
