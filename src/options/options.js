// The settings document: the token and the model, and nothing else.
//
// Nothing is validated by contacting the AI Engine. A token that does not work
// is discovered by the first run that uses it, and reported as an error kind.

import {
  DEFAULT_MODEL,
  deleteToken,
  hasToken,
  readStoredModel,
  saveSettings,
} from "../common/settings.js";

const HAS_WHITESPACE = /\s/;

// Saving with an empty token field is refused rather than treated as a
// deletion, so that an accidental save cannot silently clear a working token.
// Deleting is its own button.
export function validateToken(value) {
  const token = String(value).trim();
  if (token === "") return { ok: false, message: "Enter a token." };
  if (HAS_WHITESPACE.test(token)) {
    return {
      ok: false,
      message: "A token contains no spaces or line breaks.",
    };
  }
  return { ok: true, value: token };
}

export function validateModel(value) {
  const model = String(value).trim();
  if (model === "") return { ok: true, value: "" };
  if (HAS_WHITESPACE.test(model)) {
    return { ok: false, message: "A model name contains no spaces." };
  }
  return { ok: true, value: model };
}

function wire() {
  const fields = {
    token: document.getElementById("token"),
    tokenStatus: document.getElementById("token-status"),
    model: document.getElementById("model"),
    save: document.getElementById("save"),
    remove: document.getElementById("delete"),
    status: document.getElementById("status"),
  };

  function say(text) {
    fields.status.textContent = text;
  }

  async function refreshTokenStatus() {
    fields.tokenStatus.textContent = (await hasToken())
      ? "A token is configured."
      : "No token is configured.";
  }

  async function load() {
    // The token field is never prefilled, whatever is stored: a field the
    // reader is about to overwrite does not have to display a credential.
    fields.token.value = "";
    fields.model.placeholder = DEFAULT_MODEL;
    fields.model.value = await readStoredModel();
    await refreshTokenStatus();
  }

  fields.save.addEventListener("click", async () => {
    const token = validateToken(fields.token.value);
    if (!token.ok) {
      say(token.message);
      return;
    }
    const model = validateModel(fields.model.value);
    if (!model.ok) {
      say(model.message);
      return;
    }
    await saveSettings({ token: token.value, model: model.value });
    fields.token.value = "";
    await refreshTokenStatus();
    say("Saved.");
  });

  fields.remove.addEventListener("click", async () => {
    await deleteToken();
    fields.token.value = "";
    await refreshTokenStatus();
    say("The token was deleted.");
  });

  load();
}

if (typeof document !== "undefined") {
  wire();
}
