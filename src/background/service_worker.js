// The service worker: one run, start to finish.
//
// Every decision in a run is taken here, so that there is one place to read
// when the question is what happened. The panel renders; it decides nothing.

import {
  BLOCK_KINDS,
  MAX_REQUEST_MATERIAL_CHARS,
  chunkMaterial,
  shape,
} from "../shape/shape.js";
import { callEngine } from "../engine/engine.js";
import { readSettings } from "../common/settings.js";
import { ErrorKind } from "../common/errors.js";
import { MessageType } from "../common/messages.js";

const PANEL_PATH = "src/panel/panel.html";
const PROMPT_PATH = "prompts/summarize.md";
const EXTRACT_FILE = "src/extract/extract.js";

const KNOWN_KINDS = new Set(BLOCK_KINDS);
const activeRuns = new Map();
const pendingDiscards = new Map();

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

export function startDiscard(tabId, discard) {
  const pending = Promise.resolve()
    .then(discard)
    .finally(() => {
      if (pendingDiscards.get(tabId) === pending) pendingDiscards.delete(tabId);
    });
  pendingDiscards.set(tabId, pending);
  return pending;
}

export async function waitForDiscard(tabId) {
  await pendingDiscards.get(tabId);
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

// The boundary between instruction and material is the message boundary, not a
// delimiter inside one string. A marker inside a string is text the page could
// contain; a separate message is structure the page cannot reach.
export function composeMessages(instruction, material, task = "page") {
  const body = material.title
    ? `TITLE: ${material.title}\n\nBODY:\n${material.text}`
    : `BODY:\n${material.text}`;
  return [
    { role: "system", content: instruction },
    { role: "user", content: `TASK: ${task}\n\n${body}` },
  ];
}

function summaryMaterial(title, summaries) {
  const text = summaries
    .map((summary, index) => `PART ${index + 1}:\n${summary}`)
    .join("\n\n");
  return { title, text, charCount: title.length + text.length };
}

export async function summarizeMaterial(
  material,
  instruction,
  engineCall,
  depth = 0,
  isActive = () => true,
) {
  if (!isActive()) return null;
  if (material.charCount <= MAX_REQUEST_MATERIAL_CHARS) {
    const answer = await engineCall(
      composeMessages(instruction, material, depth ? "integrate" : "page"),
    );
    return isActive() ? answer : null;
  }

  // Bound malformed or non-compressing answers without declining ordinary
  // long pages before their content has been processed.
  if (depth >= 8) return { ok: false, kind: ErrorKind.TOO_MUCH_TEXT };

  const chunks = chunkMaterial(material);
  if (chunks.length < 2) return { ok: false, kind: ErrorKind.TOO_MUCH_TEXT };

  const summaries = [];
  for (const chunk of chunks) {
    if (!isActive()) return null;
    const answer = await engineCall(
      composeMessages(instruction, chunk, "chunk"),
    );
    if (!isActive()) return null;
    if (!answer.ok) return answer;
    summaries.push(answer.summary);
  }

  return await summarizeMaterial(
    summaryMaterial(material.title, summaries),
    instruction,
    engineCall,
    depth + 1,
    isActive,
  );
}

async function readState(tabId) {
  const stored = await chrome.storage.session.get(stateKey(tabId));
  return stored[stateKey(tabId)] || idleState();
}

async function writeState(tabId, state) {
  await chrome.storage.session.set({ [stateKey(tabId)]: state });
  // A broadcast with no listener rejects, and that is ignored: the state is
  // already stored, and a panel that opens later reads it with getState.
  chrome.runtime
    .sendMessage({ type: MessageType.STATE_CHANGED, tabId, state })
    .catch(() => {});
}

async function discardState(tabId) {
  await chrome.storage.session.remove(stateKey(tabId));
  chrome.runtime
    .sendMessage({
      type: MessageType.STATE_CHANGED,
      tabId,
      state: idleState(),
    })
    .catch(() => {});
}

// Counts and durations are what a log is allowed to know here. Never the
// token, the page's text, its title, its URL, the prompt, the request, the
// response or the summary.
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

async function fail(tabId, run, title, started, kind, detail, status) {
  if (!isCurrentRun(tabId, run)) return;
  await writeState(tabId, failedState(title, kind, detail));
  if (!isCurrentRun(tabId, run)) return;
  logRun({
    phase: "failed",
    kind,
    detail,
    status,
    elapsed: elapsedSince(started),
  });
}

// One run, in the order of the detailed design.
async function runSummary(tabId, titleFromTab) {
  // Track live work in memory so a stale stored running state left by worker
  // termination cannot permanently block the reader from trying again.
  if (!claimRun(tabId)) return;
  const run = currentRun(tabId);

  const started = Date.now();
  let title = titleFromTab || "";

  try {
    // Wait for navigation cleanup so it cannot remove this run's new state.
    await waitForDiscard(tabId);
    if (!isCurrentRun(tabId, run)) return;

    // running is written before the first await of the work, so a worker
    // terminated mid-run leaves a state that says what was happening.
    await writeState(tabId, runningState(title));

    const settings = await readSettings();
    if (!isCurrentRun(tabId, run)) return;
    if (!settings.token) {
      await fail(tabId, run, title, started, ErrorKind.TOKEN_MISSING);
      return;
    }

    let instruction;
    try {
      instruction = composeInstruction(
        await loadInstruction(),
        settings.japaneseSummary,
      );
    } catch {
      await fail(tabId, run, title, started, ErrorKind.INTERNAL_ERROR);
      return;
    }
    if (!isCurrentRun(tabId, run)) return;

    let extracted;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        files: [EXTRACT_FILE],
      });
      extracted = results && results[0] ? results[0].result : null;
    } catch {
      await fail(tabId, run, title, started, ErrorKind.PAGE_UNREADABLE);
      return;
    }
    if (!isCurrentRun(tabId, run)) return;

    if (!isValidExtractResult(extracted)) {
      await fail(tabId, run, title, started, ErrorKind.PAGE_UNREADABLE);
      return;
    }
    if (extracted.title) title = extracted.title;

    const shaped = shape(extracted);
    if (!shaped.ok) {
      await fail(tabId, run, title, started, shaped.kind);
      return;
    }

    const answer = await summarizeMaterial(
      shaped.material,
      instruction,
      (messages) =>
        callEngine({
          model: settings.model,
          messages,
          token: settings.token,
        }),
      0,
      () => isCurrentRun(tabId, run),
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
      );
      return;
    }

    if (!isCurrentRun(tabId, run)) return;
    await writeState(tabId, succeededState(title, answer.summary));
    if (!isCurrentRun(tabId, run)) return;
    logRun({
      phase: "succeeded",
      blocks: shaped.material.blockCount,
      chars: shaped.material.charCount,
      elapsed: elapsedSince(started),
    });
  } catch {
    // So that "no failure is silent" survives an exception nobody predicted.
    await fail(tabId, run, title, started, ErrorKind.INTERNAL_ERROR);
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
  const configured = sidePanel.setOptions({
    tabId,
    path: PANEL_PATH,
    enabled: true,
  });
  const opened = sidePanel.open({ tabId });
  await Promise.all([configured, opened]);
  startRun(tabId, tab.title || "");
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
  // begins. sidePanel.open() requires a user gesture, so openPanelAndRun calls
  // it before awaiting either panel operation.
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
    // a tab that no longer exists.
    invalidateRun(tabId);
    chrome.storage.session.remove(stateKey(tabId)).catch(() => {});
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo && changeInfo.status === "loading") {
      invalidateRun(tabId);
      startDiscard(tabId, () => discardState(tabId)).catch(() => {});
    }
  });
}

if (typeof chrome !== "undefined" && chrome.action && chrome.runtime) {
  registerListeners();
}
