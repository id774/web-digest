// Selects one provider adapter and calls it. Nothing else in this module
// speaks a provider's protocol, and nothing here ever calls more than one
// adapter for one logical request.
//
// There is no fallback path: a failure from the selected adapter is returned
// exactly as the adapter reported it, never retried against another provider,
// raced against one, or compared with one. The only thing a caller decides is
// which provider is selected; this module never decides that on its own.

import { Provider } from "../common/settings.js";
import { ErrorKind } from "../common/errors.js";
import { callSakura } from "./sakura.js";
import { callOpenAI } from "./openai.js";
import { callClaude } from "./claude.js";
import { REQUEST_TIMEOUT_MS } from "./transport.js";

export { REQUEST_TIMEOUT_MS };

const ADAPTERS = {
  [Provider.SAKURA]: callSakura,
  [Provider.OPENAI]: callOpenAI,
  [Provider.ANTHROPIC]: callClaude,
};

// { provider, model, credential, instruction, content } -> a normalized
// result, exactly as the chosen adapter returned it. `provider` must be one
// of the three supported identifiers; anything else is this repository's own
// fault, not a reader-facing case, and is reported as internal-error.
export async function callProvider(
  { provider, model, credential, instruction, content },
  options = {},
) {
  const call = ADAPTERS[provider];
  if (!call) return { ok: false, kind: ErrorKind.INTERNAL_ERROR };
  return call({ model, credential, instruction, content }, options);
}
