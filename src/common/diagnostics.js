// Optional diagnostics for one summarization run: a short, ordered list of
// what the run actually did and where it stopped.
//
// Every event is built from a fixed vocabulary of steps, outcomes, tasks and
// error kinds, plus a few non-negative integers. Nothing free-form can enter
// an event: not a credential, a provider or model name, a page's text, title
// or URL, the prompt, a request or response, a summary, or an exception. An
// event that does not fit the vocabulary is dropped, not repaired.
//
// The record is a per-tab, session-only aid. It never decides anything about
// the run it describes, and recording it can never throw into that run.

import { ErrorKind, ProviderErrorDetail } from "./errors.js";

export const DIAGNOSTICS_KEY_PREFIX = "diag:";

export function diagnosticsKey(tabId) {
  return `${DIAGNOSTICS_KEY_PREFIX}${tabId}`;
}

// The points of a run at which something is observed. `permission` is
// deliberately absent: whether a host permission had to be checked depends on
// the selected provider, which a diagnostic never reveals.
export const DiagStep = {
  SETTINGS: "settings",
  PROMPT: "prompt",
  EXTRACT: "extract",
  SHAPE: "shape",
  SPLIT: "split",
  REQUEST_START: "request-start",
  REQUEST_END: "request-end",
  RESULT: "result",
};

export const DiagOutcome = {
  OK: "ok",
  FAILED: "failed",
  EXCEPTION: "exception",
};

export const DiagTask = {
  PAGE: "page",
  CHUNK: "chunk",
  INTEGRATE: "integrate",
};

const STEPS = new Set(Object.values(DiagStep));
const OUTCOMES = new Set(Object.values(DiagOutcome));
const TASKS = new Set(Object.values(DiagTask));
const ERROR_KINDS = new Set(Object.values(ErrorKind));
const DETAILS = new Set(Object.values(ProviderErrorDetail));

// The integer fields an event may carry. `ms` is elapsed time since the run
// began. `requestMs` is the duration of one provider request.
const NUMBER_FIELDS = [
  "depth",
  "index",
  "total",
  "chunks",
  "blocks",
  "chars",
  "status",
  "requestMs",
];

const MAX_NUMBER = 1e12;

// Retention bounds. They were chosen from measured sizes of the longest
// realistic runs. See doc/DETAILED_DESIGN.md §19.3 for the measurements.
// Events past MAX_EVENTS - RESERVED_FOR_RESULT, or past MAX_BYTES less
// RESERVED_BYTES_FOR_RESULT, are counted, not kept, so the final result
// always has room. MAX_BYTES bounds the stored record.
export const MAX_EVENTS = 400;
export const RESERVED_FOR_RESULT = 4;
export const MAX_BYTES = 49152;
export const RESERVED_BYTES_FOR_RESULT = 1024;
export const RECORD_VERSION = 1;

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_NUMBER;
}

// A raw event in, an allowlisted event out, or null when it has no valid step.
export function sanitizeEvent(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.step !== "string" || !STEPS.has(raw.step)) return null;
  if (!isCount(raw.seq) || !isCount(raw.ms)) return null;
  const event = { seq: raw.seq, ms: raw.ms, step: raw.step };
  if (typeof raw.outcome === "string" && OUTCOMES.has(raw.outcome)) {
    event.outcome = raw.outcome;
  }
  if (typeof raw.task === "string" && TASKS.has(raw.task)) event.task = raw.task;
  if (typeof raw.errorKind === "string" && ERROR_KINDS.has(raw.errorKind)) {
    event.errorKind = raw.errorKind;
  }
  if (typeof raw.detail === "string" && DETAILS.has(raw.detail)) {
    event.detail = raw.detail;
  }
  for (const field of NUMBER_FIELDS) {
    if (isCount(raw[field])) event[field] = raw[field];
  }
  return event;
}

export function emptyRecord() {
  return { v: RECORD_VERSION, events: [], dropped: 0, last: null };
}

// A stored value in, a valid record out, or null. Nothing a record carries is
// trusted just because it came from storage.
export function sanitizeRecord(value) {
  if (!value || typeof value !== "object" || value.v !== RECORD_VERSION) {
    return null;
  }
  if (!Array.isArray(value.events) || value.events.length > MAX_EVENTS) {
    return null;
  }
  const events = [];
  for (const raw of value.events) {
    const event = sanitizeEvent(raw);
    if (!event) return null;
    events.push(event);
  }
  const dropped = isCount(value.dropped) ? value.dropped : 0;
  const last = value.last === null ? null : sanitizeEvent(value.last);
  return { v: RECORD_VERSION, events, dropped, last };
}

const encoder = new TextEncoder();

export function recordBytes(record) {
  return encoder.encode(JSON.stringify(record)).length;
}

// Appends a sanitized event. The record gains the event only while it fits
// the event and byte bounds. Otherwise the event is counted in `dropped` and
// remembered as `last`, so a reader still learns how far the run got. The
// final result alone may use the room kept back for it.
export function appendEvent(record, event) {
  const terminal = event.step === DiagStep.RESULT;
  const eventLimit = terminal ? MAX_EVENTS : MAX_EVENTS - RESERVED_FOR_RESULT;
  const byteLimit = terminal ? MAX_BYTES : MAX_BYTES - RESERVED_BYTES_FOR_RESULT;
  if (record.events.length < eventLimit) {
    record.events.push(event);
    if (recordBytes(record) <= byteLimit) return;
    record.events.pop();
  }
  record.dropped += 1;
  record.last = event;
}

// The recorder a run uses. When diagnostics are off it is inert: it holds no
// record and calls nothing. `persist` receives the record after each change
// and is the caller's business. A failure there is never this module's.
export function createRecorder({
  enabled,
  started,
  now = Date.now,
  persist = () => {},
}) {
  if (!enabled) return { enabled: false, record() {} };
  const record = emptyRecord();
  let seq = 0;
  return {
    enabled: true,
    record(step, fields = {}) {
      try {
        const event = sanitizeEvent({
          ...fields,
          step,
          seq,
          ms: Math.max(0, Math.round(now() - started)),
        });
        seq += 1;
        if (!event) return;
        appendEvent(record, event);
        persist(record);
      } catch {
        // Recording never reaches the run it describes.
      }
    },
  };
}

function describe(event) {
  const parts = [`#${event.seq}`, `+${(event.ms / 1000).toFixed(1)}s`, event.step];
  if (event.task) parts.push(`task=${event.task}`);
  if (typeof event.depth === "number") parts.push(`depth=${event.depth}`);
  if (typeof event.index === "number") {
    parts.push(
      typeof event.total === "number"
        ? `part=${event.index}/${event.total}`
        : `part=${event.index}`,
    );
  } else if (typeof event.total === "number") {
    parts.push(`total=${event.total}`);
  }
  if (typeof event.chunks === "number") parts.push(`chunks=${event.chunks}`);
  if (typeof event.blocks === "number") parts.push(`blocks=${event.blocks}`);
  if (typeof event.chars === "number") parts.push(`chars=${event.chars}`);
  if (event.outcome) parts.push(`outcome=${event.outcome}`);
  if (event.errorKind) parts.push(`kind=${event.errorKind}`);
  if (event.detail) parts.push(`detail=${event.detail}`);
  if (typeof event.status === "number") parts.push(`status=${event.status}`);
  if (typeof event.requestMs === "number") {
    parts.push(`took=${(event.requestMs / 1000).toFixed(1)}s`);
  }
  return parts.join(" ");
}

// Plain text, one line per event. `finished` says whether the run has ended
// in a result the reader can see. A record with no recorded result then is
// reported as incomplete rather than presented as the whole story.
// `stateKnown: false` says the caller has not yet confirmed the run's state:
// the events seen so far are shown, and the run is called neither ended nor
// still going. Events that were dropped are reported either way.
export function formatDiagnostics(
  record,
  { finished = false, stateKnown = true } = {},
) {
  const lines = record.events.map(describe);
  const hasResult = record.events.some((e) => e.step === DiagStep.RESULT);
  if (record.dropped > 0) {
    lines.push(
      `Incomplete: ${record.dropped} later event${record.dropped === 1 ? " was" : "s were"} not retained.`,
    );
    if (record.last) lines.push(`Last observed: ${describe(record.last)}`);
  } else if (!stateKnown) {
    // Neither ended nor still running can be claimed yet.
  } else if (finished && !hasResult) {
    lines.push("Incomplete: no final result was recorded for this run.");
  } else if (!finished && !hasResult) {
    lines.push("This run has not ended yet. Events appear as they are recorded.");
  }
  return lines.join("\n");
}
