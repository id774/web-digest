// The service worker: one run, start to finish.
//
// Every decision in a run is taken here, so that there is one place to read
// when the question is what happened. The panel renders. It decides nothing.

import {
  BLOCK_KINDS,
  MAX_REQUEST_MATERIAL_CHARS,
  chunkMaterial,
  shape,
} from "../shape/shape.js";
import { callProvider } from "../engine/dispatcher.js";
import { readDiagnosticLogging, readSettings } from "../common/settings.js";
import {
  hasProviderPermission,
  needsOptionalPermission,
} from "../common/permissions.js";
import { ErrorKind } from "../common/errors.js";
import { MessageType } from "../common/messages.js";
import {
  DiagOutcome,
  DiagStep,
  DiagTask,
  createRecorder,
  diagnosticsKey,
  emptyRecord,
} from "../common/diagnostics.js";

const PANEL_PATH = "src/panel/panel.html";
const PROMPT_PATH = "prompts/summarize.md";
const EXTRACT_FILE = "src/extract/extract.js";

// Chrome ends an idle service worker after about 30 seconds without an
// extension API call, and a provider request can be slower than that on its
// own. A pulse shorter than that window resets the lifetime timer while the
// summarization operation runs.
export const SERVICE_WORKER_KEEPALIVE_INTERVAL_MS = 25000;

const KNOWN_KINDS = new Set(BLOCK_KINDS);
const activeRuns = new Map();

// Every chrome.storage.session mutation for a tab — a run's own write and a
// navigation/close cleanup's remove alike — is appended to this tab's own
// chain, so a write already in flight when a cleanup starts is guaranteed to
// finish before the remove that follows it, and cleanups for the same tab
// can never land out of the order they were asked for. A generation check
// alone cannot give this guarantee: it only stops a write from being
// started, not one that is already in flight.
const tabMutationQueue = new Map();

function enqueueStateMutation(tabId, task) {
  const previous = tabMutationQueue.get(tabId);
  const chained = previous ? previous.catch(() => {}).then(task) : task();
  tabMutationQueue.set(tabId, chained);
  chained.catch(() => {}).finally(() => {
    if (tabMutationQueue.get(tabId) === chained) tabMutationQueue.delete(tabId);
  });
  return chained;
}

// The two output-language modes `prompts/summarize.md` defines. The mode is
// fixed once per run and carried by the instruction itself, so page content
// in the material message can never reach or change it.
export const LanguageMode = {
  SOURCE: "source",
  JAPANESE: "japanese",
};

export function composeInstruction(baseInstruction, japaneseSummary) {
  const mode = japaneseSummary ? LanguageMode.JAPANESE : LanguageMode.SOURCE;
  return `${baseInstruction}\n\nLANGUAGE MODE: ${mode}`;
}

function stateKey(tabId) {
  return `run:${tabId}`;
}

export function idleState() {
  return {
    phase: "idle",
    title: "",
    summary: "",
    errorKind: "",
    errorDetail: "",
  };
}

export function runningState(title) {
  return { ...idleState(), phase: "running", title: title || "" };
}

export function succeededState(title, summary) {
  return {
    ...idleState(),
    phase: "succeeded",
    title: title || "",
    summary,
  };
}

export function failedState(title, kind, detail) {
  return {
    ...idleState(),
    phase: "failed",
    title: title || "",
    errorKind: kind,
    errorDetail: detail || "",
  };
}

export function claimRun(tabId) {
  if (activeRuns.has(tabId)) return false;
  activeRuns.set(tabId, Symbol());
  return true;
}

export function currentRun(tabId) {
  return activeRuns.get(tabId);
}

export function isCurrentRun(tabId, run) {
  return activeRuns.get(tabId) === run;
}

export function releaseRun(tabId, run = activeRuns.get(tabId)) {
  if (isCurrentRun(tabId, run)) activeRuns.delete(tabId);
}

export function invalidateRun(tabId) {
  activeRuns.delete(tabId);
}

// True at the boundary Chrome uses to mark a tab's page as having changed —
// either a `loading` status or the mere presence of a `url` field on the
// update, never the value either one carries. `Object.hasOwn` proves the
// property exists without reading it, so a navigation is recognized without
// this predicate ever touching the URL string itself.
export function isNavigationBoundary(changeInfo) {
  return Boolean(
    changeInfo &&
      (changeInfo.status === "loading" || Object.hasOwn(changeInfo, "url")),
  );
}

export function startDiscard(tabId, discard) {
  return enqueueStateMutation(tabId, discard);
}

export async function waitForDiscard(tabId) {
  await tabMutationQueue.get(tabId);
}

// An object, with blocks an array and title a string, every block carrying a
// known kind and a string text. Anything else is page-unreadable.
export function isValidExtractResult(value) {
  if (!value || typeof value !== "object") return false;
  if (typeof value.title !== "string") return false;
  if (!Array.isArray(value.blocks)) return false;
  return value.blocks.every(
    (block) =>
      block &&
      typeof block === "object" &&
      KNOWN_KINDS.has(block.kind) &&
      typeof block.text === "string",
  );
}

// The boundary between instruction and material is a field boundary in this
// provider-neutral logical request, not a delimiter inside one string. Each
// adapter maps `instruction` and `content` to its own protocol's trusted and
// untrusted parts (a system message and a user message, `instructions` and
// `input`, or `system` and a user message) — never one string a marker could
// be found inside, and a marker inside `content` is text the page could
// contain, never structure the page can reach.
export function composeRequest(instruction, material, task = "page") {
  const body = material.title
    ? `TITLE: ${material.title}\n\nBODY:\n${material.text}`
    : `BODY:\n${material.text}`;
  return {
    instruction: `${instruction}\n\nTASK: ${task}`,
    content: body,
  };
}

function summaryMaterial(title, summaries) {
  const text = summaries
    .map((summary, index) => `PART ${index + 1}:\n${summary}`)
    .join("\n\n");
  return { title, text, charCount: title.length + text.length };
}

// Observation is a side channel: `observe` receives a step and non-text facts
// about it, and nothing it does or throws changes what the run does.
const noObserve = () => {};

function safeObserve(observe) {
  return (step, facts) => {
    try {
      observe(step, facts);
    } catch {
      // An observer's failure is never the run's.
    }
  };
}

async function observedCall(providerCall, request, observe, facts) {
  const began = Date.now();
  observe(DiagStep.REQUEST_START, facts);
  let answer;
  try {
    answer = await providerCall(request);
  } catch (error) {
    observe(DiagStep.REQUEST_END, {
      ...facts,
      outcome: DiagOutcome.EXCEPTION,
      requestMs: Date.now() - began,
    });
    throw error;
  }
  observe(DiagStep.REQUEST_END, {
    ...facts,
    outcome: answer && answer.ok ? DiagOutcome.OK : DiagOutcome.FAILED,
    errorKind: answer && !answer.ok ? answer.kind : undefined,
    detail: answer && !answer.ok ? answer.detail : undefined,
    status: answer && !answer.ok ? answer.status : undefined,
    requestMs: Date.now() - began,
  });
  return answer;
}

export async function summarizeMaterial(
  material,
  instruction,
  providerCall,
  depth = 0,
  isActive = () => true,
  observe = noObserve,
) {
  observe = safeObserve(observe);
  if (!isActive()) return null;
  if (material.charCount <= MAX_REQUEST_MATERIAL_CHARS) {
    const task = depth ? DiagTask.INTEGRATE : DiagTask.PAGE;
    const answer = await observedCall(
      providerCall,
      composeRequest(instruction, material, task),
      observe,
      { task, depth, chars: material.charCount },
    );
    return isActive() ? answer : null;
  }

  // Bound malformed or non-compressing answers without declining ordinary
  // long pages before their content has been processed.
  if (depth >= 8) {
    observe(DiagStep.SPLIT, {
      depth,
      chars: material.charCount,
      outcome: DiagOutcome.FAILED,
      errorKind: ErrorKind.TOO_MUCH_TEXT,
    });
    return { ok: false, kind: ErrorKind.TOO_MUCH_TEXT };
  }

  const chunks = chunkMaterial(material);
  if (chunks.length < 2) {
    observe(DiagStep.SPLIT, {
      depth,
      chunks: chunks.length,
      chars: material.charCount,
      outcome: DiagOutcome.FAILED,
      errorKind: ErrorKind.TOO_MUCH_TEXT,
    });
    return { ok: false, kind: ErrorKind.TOO_MUCH_TEXT };
  }
  observe(DiagStep.SPLIT, {
    depth,
    chunks: chunks.length,
    chars: material.charCount,
    outcome: DiagOutcome.OK,
  });

  const summaries = [];
  for (const [position, chunk] of chunks.entries()) {
    if (!isActive()) return null;
    const answer = await observedCall(
      providerCall,
      composeRequest(instruction, chunk, "chunk"),
      observe,
      {
        task: DiagTask.CHUNK,
        depth,
        index: position + 1,
        total: chunks.length,
        chars: chunk.charCount,
      },
    );
    if (!isActive()) return null;
    if (!answer.ok) return answer;
    summaries.push(answer.summary);
  }

  return await summarizeMaterial(
    summaryMaterial(material.title, summaries),
    instruction,
    providerCall,
    depth + 1,
    isActive,
    observe,
  );
}

// The interval belongs to the one operation it covers: it is created before
// the operation starts, it is cleared however the operation ends, and no
// module-level handle outlives it.
export async function keepServiceWorkerAlive(
  operation,
  {
    runtimeApi = chrome.runtime,
    setIntervalImpl = setInterval,
    clearIntervalImpl = clearInterval,
  } = {},
) {
  const keepAlive = setIntervalImpl(() => {
    runtimeApi.getPlatformInfo().catch(() => {
      // The pulse has no application result to surface. The run's own
      // provider result, timeout, or failure remains authoritative.
    });
  }, SERVICE_WORKER_KEEPALIVE_INTERVAL_MS);

  try {
    return await operation();
  } finally {
    clearIntervalImpl(keepAlive);
  }
}

// Never rejects: a storage read failure becomes an explicit internal-error
// response, `{ errorKind }` with no RunState field, not a dropped message
// port and not a stored-looking failed RunState: the panel can show the
// error without taking it as evidence that a run ended.
async function readState(tabId) {
  try {
    // If a mutation for this tab is already queued when this read begins,
    // wait for that queue to settle before reading storage, so this cannot
    // return the state between an invalidated write and the cleanup already
    // queued behind it.
    await waitForDiscard(tabId);
    const stored = await chrome.storage.session.get(stateKey(tabId));
    return stored[stateKey(tabId)] || idleState();
  } catch {
    return { errorKind: ErrorKind.INTERNAL_ERROR };
  }
}

// Queued behind whatever is already pending for this tab, and a no-op if
// `run` has since stopped being the tab's current run: a write a navigation
// or close outran while it was still queued must never land after that
// cleanup's remove.
async function writeState(tabId, state, run) {
  return enqueueStateMutation(tabId, async () => {
    if (!isCurrentRun(tabId, run)) return;
    await chrome.storage.session.set({ [stateKey(tabId)]: state });
    // Checked again after the write settles: navigation, closure or
    // replacement may have invalidated this run while the write was in
    // flight, and the old state it just stored must never be broadcast once
    // that has happened.
    if (!isCurrentRun(tabId, run)) return;
    // A broadcast with no listener rejects, and that is ignored: the state is
    // already stored, and a panel that opens later reads it with getState.
    chrome.runtime
      .sendMessage({ type: MessageType.STATE_CHANGED, tabId, state })
      .catch(() => {});
  });
}

// Unconditional: a cleanup always removes, regardless of which run — if any
// — is current by the time its turn in the queue comes up. A remove failure
// is caught rather than left to swallow the idle notification with it — the
// two outcomes below are independent of whether it succeeded, and a stale
// stored RunState is never left as the reload-time authority: one fallback
// write of the idle state stands in for a remove that did not go through,
// never a second attempt of either.
async function discardState(tabId) {
  try {
    await chrome.storage.session.remove(stateKey(tabId));
  } catch {
    try {
      await chrome.storage.session.set({ [stateKey(tabId)]: idleState() });
    } catch {
      // Storage is not answering either write. The broadcast below is the
      // only signal left to try.
    }
  }
  await removeDiagnostics(tabId);
  chrome.runtime
    .sendMessage({
      type: MessageType.STATE_CHANGED,
      tabId,
      state: idleState(),
    })
    .catch(() => {});
}

// Removes the tab's diagnostics if there are any. The record is looked for
// first so that a tab that never recorded one costs no remove. When the look
// itself fails, the remove is attempted anyway, since leaving a record behind
// is the worse outcome. A failure here is the diagnostics' own and is never
// surfaced.
async function removeDiagnostics(tabId) {
  const key = diagnosticsKey(tabId);
  let present = true;
  try {
    const stored = await chrome.storage.session.get(key);
    present = Boolean(stored) && stored[key] !== undefined;
  } catch {
    present = true;
  }
  if (!present) return;
  try {
    await chrome.storage.session.remove(key);
  } catch {
    // A record that cannot be removed must not stay as the old run's account
    // of a later run. One fallback write of an empty record stands in for the
    // remove, never a retry of it, and the panel shows an empty record as
    // nothing. If that write fails too, nothing more can be done here.
    try {
      await chrome.storage.session.set({ [key]: emptyRecord() });
    } catch {
      // Storage is not answering either call.
    }
  }
}

// Queued behind whatever is pending for this tab, so a previous run's record
// is gone before this run's own state is written.
function clearDiagnostics(tabId) {
  return enqueueStateMutation(tabId, () => removeDiagnostics(tabId));
}

// The diagnostics of one run are written through the same per-tab queue as
// its state, and skipped once the run is no longer the tab's current one, so
// a navigation or closure can never be followed by a late diagnostic write.
// Writes coalesce: while one is in flight, further changes only mark the
// record dirty, and the latest record is written once the current write ends.
// A failed write is dropped. The run neither waits for it nor learns of it.
function diagnosticsPersister(tabId, run) {
  let writing = false;
  let dirty = false;
  let latest = null;
  return (record) => {
    latest = record;
    dirty = true;
    if (writing) return;
    writing = true;
    enqueueStateMutation(tabId, async () => {
      try {
        while (dirty && isCurrentRun(tabId, run)) {
          dirty = false;
          await chrome.storage.session.set({
            [diagnosticsKey(tabId)]: structuredClone(latest),
          });
        }
      } catch {
        // The record stays at whatever last reached storage.
      } finally {
        dirty = false;
        writing = false;
      }
    }).catch(() => {});
  };
}

// Counts and durations are what a log is allowed to know here. Never a
// credential, the page's text, its title, its URL, the prompt, the request,
// the response, the summary, or which provider was used.
function logRun(fields) {
  const parts = [`phase=${fields.phase}`];
  if (fields.kind) parts.push(`kind=${fields.kind}`);
  if (fields.detail) parts.push(`detail=${fields.detail}`);
  if (typeof fields.status === "number") parts.push(`status=${fields.status}`);
  if (typeof fields.blocks === "number") parts.push(`blocks=${fields.blocks}`);
  if (typeof fields.chars === "number") parts.push(`chars=${fields.chars}`);
  parts.push(`elapsed=${fields.elapsed}s`);
  const line = `web-digest run: ${parts.join(" ")}`;
  if (fields.phase === "failed") {
    console.error(line);
  } else {
    console.log(line);
  }
}

function elapsedSince(started) {
  return ((Date.now() - started) / 1000).toFixed(1);
}

async function loadInstruction() {
  const response = await fetch(chrome.runtime.getURL(PROMPT_PATH));
  if (!response.ok) throw new Error("the prompt resource could not be read");
  return await response.text();
}

// Never itself throws: a run's own try/catch calls this from its catch
// block and from every early-return failure path, and a second exception
// escaping from here — the same storage write that is already the failure
// failing again — would leave that catch block, and the run's promise,
// rejecting with nothing left to catch it.
export async function fail(
  tabId,
  run,
  title,
  started,
  kind,
  detail,
  status,
  recorder,
) {
  if (!isCurrentRun(tabId, run)) return;
  if (recorder) {
    recorder.record(DiagStep.RESULT, {
      outcome: DiagOutcome.FAILED,
      errorKind: kind,
      detail,
      status,
    });
  }
  const state = failedState(title, kind, detail);
  try {
    await writeState(tabId, state, run);
  } catch {
    // The write itself failed. Retrying the same failing storage helper
    // would not help. Broadcasting the state directly, best-effort, is the
    // only way a reader watching this tab's panel can still learn the run
    // ended.
    chrome.runtime
      .sendMessage({ type: MessageType.STATE_CHANGED, tabId, state })
      .catch(() => {});
  }
  if (!isCurrentRun(tabId, run)) return;
  logRun({
    phase: "failed",
    kind,
    detail,
    status,
    elapsed: elapsedSince(started),
  });
}

// One run, in the order of the detailed design. The run identity is claimed
// by openPanelAndRun before either side-panel operation, and is carried in
// here as `run` rather than claimed anew, so a navigation that invalidates
// the click while the panel is still opening is not missed by arriving too
// early for a token to exist yet.
async function runSummary(tabId, titleFromTab, run) {
  if (!isCurrentRun(tabId, run)) return;

  const started = Date.now();
  let title = titleFromTab || "";
  let recorder = createRecorder({ enabled: false });

  try {
    // Wait for navigation cleanup so it cannot remove this run's new state.
    await waitForDiscard(tabId);
    if (!isCurrentRun(tabId, run)) return;

    // A record left by an earlier run of this tab is removed before this
    // run's own state is written, whether or not this run records one.
    await clearDiagnostics(tabId);
    if (!isCurrentRun(tabId, run)) return;

    // running is written before the first await of the work, so a worker
    // terminated mid-run leaves a state that says what was happening.
    await writeState(tabId, runningState(title), run);

    const settings = await readSettings();
    if (!isCurrentRun(tabId, run)) return;

    // Whether this run records diagnostics is fixed here, once. A preference
    // that cannot be read means off, and recording can never fail the run.
    let diagnosticsEnabled = false;
    try {
      diagnosticsEnabled = await readDiagnosticLogging();
    } catch {
      diagnosticsEnabled = false;
    }
    if (!isCurrentRun(tabId, run)) return;
    recorder = createRecorder({
      enabled: diagnosticsEnabled,
      started,
      persist: diagnosticsPersister(tabId, run),
    });

    if (!settings.credential) {
      recorder.record(DiagStep.SETTINGS, { outcome: DiagOutcome.FAILED });
      await fail(
        tabId,
        run,
        title,
        started,
        ErrorKind.CREDENTIAL_MISSING,
        undefined,
        undefined,
        recorder,
      );
      return;
    }
    recorder.record(DiagStep.SETTINGS, { outcome: DiagOutcome.OK });

    // A provider whose host permission is optional (OpenAI, Claude, Kimi) may
    // have had that permission revoked since it was granted. This is checked, not
    // requested: a run never prompts for a permission, and a missing one ends
    // the run here, before the page is read, the same as a missing credential.
    if (needsOptionalPermission(settings.provider)) {
      const granted = await hasProviderPermission(settings.provider);
      if (!isCurrentRun(tabId, run)) return;
      if (!granted) {
        await fail(
          tabId,
          run,
          title,
          started,
          ErrorKind.PERMISSION_MISSING,
          undefined,
          undefined,
          recorder,
        );
        return;
      }
    }

    let instruction;
    try {
      instruction = composeInstruction(
        await loadInstruction(),
        settings.japaneseSummary,
      );
    } catch {
      recorder.record(DiagStep.PROMPT, { outcome: DiagOutcome.FAILED });
      await fail(
        tabId,
        run,
        title,
        started,
        ErrorKind.INTERNAL_ERROR,
        undefined,
        undefined,
        recorder,
      );
      return;
    }
    if (!isCurrentRun(tabId, run)) return;
    recorder.record(DiagStep.PROMPT, { outcome: DiagOutcome.OK });

    let extracted;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        files: [EXTRACT_FILE],
      });
      extracted = results && results[0] ? results[0].result : null;
    } catch {
      recorder.record(DiagStep.EXTRACT, { outcome: DiagOutcome.FAILED });
      await fail(
        tabId,
        run,
        title,
        started,
        ErrorKind.PAGE_UNREADABLE,
        undefined,
        undefined,
        recorder,
      );
      return;
    }
    if (!isCurrentRun(tabId, run)) return;

    if (!isValidExtractResult(extracted)) {
      recorder.record(DiagStep.EXTRACT, { outcome: DiagOutcome.FAILED });
      await fail(
        tabId,
        run,
        title,
        started,
        ErrorKind.PAGE_UNREADABLE,
        undefined,
        undefined,
        recorder,
      );
      return;
    }
    recorder.record(DiagStep.EXTRACT, {
      outcome: DiagOutcome.OK,
      blocks: extracted.blocks.length,
    });
    if (extracted.title) title = extracted.title;

    const shaped = shape(extracted);
    if (!shaped.ok) {
      recorder.record(DiagStep.SHAPE, {
        outcome: DiagOutcome.FAILED,
        errorKind: shaped.kind,
      });
      await fail(
        tabId,
        run,
        title,
        started,
        shaped.kind,
        undefined,
        undefined,
        recorder,
      );
      return;
    }
    recorder.record(DiagStep.SHAPE, {
      outcome: DiagOutcome.OK,
      blocks: shaped.material.blockCount,
      chars: shaped.material.charCount,
    });

    const answer = await keepServiceWorkerAlive(() =>
      summarizeMaterial(
        shaped.material,
        instruction,
        (logicalRequest) =>
          callProvider({
            provider: settings.provider,
            model: settings.model,
            credential: settings.credential,
            instruction: logicalRequest.instruction,
            content: logicalRequest.content,
          }),
        0,
        () => isCurrentRun(tabId, run),
        recorder.record,
      ),
    );

    if (!answer) return;
    if (!answer.ok) {
      await fail(
        tabId,
        run,
        title,
        started,
        answer.kind,
        answer.detail,
        answer.status,
        recorder,
      );
      return;
    }

    if (!isCurrentRun(tabId, run)) return;
    recorder.record(DiagStep.RESULT, {
      outcome: DiagOutcome.OK,
      blocks: shaped.material.blockCount,
      chars: shaped.material.charCount,
    });
    await writeState(tabId, succeededState(title, answer.summary), run);
    if (!isCurrentRun(tabId, run)) return;
    logRun({
      phase: "succeeded",
      blocks: shaped.material.blockCount,
      chars: shaped.material.charCount,
      elapsed: elapsedSince(started),
    });
  } catch {
    // So that "no failure is silent" survives an exception nobody predicted.
    await fail(
      tabId,
      run,
      title,
      started,
      ErrorKind.INTERNAL_ERROR,
      undefined,
      undefined,
      recorder,
    );
  } finally {
    releaseRun(tabId, run);
  }
}

export async function openPanelAndRun(
  tab,
  sidePanel = chrome.sidePanel,
  startRun = runSummary,
) {
  if (!tab || typeof tab.id !== "number") return;
  const tabId = tab.id;

  const claimed = claimRun(tabId);
  const run = claimed ? currentRun(tabId) : undefined;

  // open() must be called while the action click's user gesture is still
  // active, so it is invoked before awaiting setOptions()'s completion.
  // A successfully claimed run identity already exists while both panel
  // operations are pending, so navigation can invalidate this click before
  // it reaches extraction. A synchronous exception from either call is
  // handled the same as a rejection from its returned operation: the
  // claimed identity is released and the action path ends with no run.
  let configured;
  try {
    configured = sidePanel.setOptions({
      tabId,
      path: PANEL_PATH,
      enabled: true,
    });
  } catch (error) {
    if (claimed) releaseRun(tabId, run);
    throw error;
  }

  let opened;
  try {
    opened = sidePanel.open({ tabId });
  } catch (error) {
    // setOptions() already returned its own Promise. Observe it right away
    // so a later rejection from it cannot become an unhandled rejection now
    // that nothing else is going to await it.
    Promise.resolve(configured).catch(() => {});
    if (claimed) releaseRun(tabId, run);
    throw error;
  }

  try {
    await Promise.all([configured, opened]);
  } catch (error) {
    if (claimed) releaseRun(tabId, run);
    throw error;
  }

  if (!claimed || !isCurrentRun(tabId, run)) return;
  startRun(tabId, tab.title || "", run);
}

function registerListeners() {
  // Load bearing: with the behaviour turned on Chrome opens the panel itself
  // and chrome.action.onClicked never fires, so the one click would open a
  // panel and start nothing.
  chrome.runtime.onInstalled.addListener(() => {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: false })
      .catch(() => {});
  });

  // The click is the reader's explicit request, and it is the only way a run
  // begins. sidePanel.open() requires the action click's user gesture, so
  // openPanelAndRun calls open() before awaiting either panel Promise.
  chrome.action.onClicked.addListener((tab) => {
    openPanelAndRun(tab).catch(() => {});
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") return false;

    if (message.type === MessageType.GET_STATE) {
      readState(message.tabId).then(sendResponse);
      return true;
    }

    return false;
  });

  // Discarding is all these do: they start nothing, read no page, record
  // nothing and hold no URL.
  chrome.tabs.onRemoved.addListener((tabId) => {
    // Invalidate before removing, so a late answer cannot restore the state of
    // a tab that no longer exists. Queued the same way navigation's cleanup
    // is, so a write already in flight for this tab is guaranteed to finish
    // before this remove, never after it.
    invalidateRun(tabId);
    startDiscard(tabId, () => discardState(tabId)).catch(() => {});
  });

  // A replacement retires removedTabId as a tab identity. The added identity
  // is not a migration target. Cleanup targets removedTabId only, the same
  // invalidate-then-discard ordering onRemoved uses, and starts no run.
  chrome.tabs.onReplaced.addListener((_addedTabId, removedTabId) => {
    invalidateRun(removedTabId);
    startDiscard(removedTabId, () => discardState(removedTabId)).catch(() => {});
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (isNavigationBoundary(changeInfo)) {
      invalidateRun(tabId);
      startDiscard(tabId, () => discardState(tabId)).catch(() => {});
    }
  });
}

if (typeof chrome !== "undefined" && chrome.action && chrome.runtime) {
  registerListeners();
}
