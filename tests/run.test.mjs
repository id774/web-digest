import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  claimRun,
  composeMessages,
  currentRun,
  failedState,
  idleState,
  invalidateRun,
  isCurrentRun,
  isValidExtractResult,
  runningState,
  releaseRun,
  summarizeMaterial,
  succeededState,
} from "../src/background/service_worker.js";
import { MAX_REQUEST_MATERIAL_CHARS } from "../src/shape/shape.js";
import { ErrorKind, EngineErrorDetail, messageFor } from "../src/common/errors.js";
import { MessageType } from "../src/common/messages.js";

const INSTRUCTION = "# Summarize a web page\n\nProduce a summary of it.";

test("the instruction and the material are two messages, not one string", () => {
  const messages = composeMessages(INSTRUCTION, {
    title: "A title",
    text: "A paragraph.",
    charCount: 20,
    blockCount: 1,
  });
  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0], { role: "system", content: INSTRUCTION });
  assert.equal(messages[1].role, "user");
  assert.equal(messages[1].content, "TASK: page\n\nTITLE: A title\n\nBODY:\nA paragraph.");
});

test("an empty title omits the TITLE line", () => {
  const messages = composeMessages(INSTRUCTION, {
    title: "",
    text: "A paragraph.",
    charCount: 12,
    blockCount: 1,
  });
  assert.equal(messages[1].content, "TASK: page\n\nBODY:\nA paragraph.");
});

test("the instruction reaches the request unchanged", () => {
  const messages = composeMessages(INSTRUCTION, {
    title: "T",
    text: "B",
    charCount: 2,
    blockCount: 1,
  });
  assert.equal(messages[0].content, INSTRUCTION);
});

test("a well-formed extraction result is accepted", () => {
  assert.equal(
    isValidExtractResult({
      title: "A title",
      blocks: [
        { kind: "heading", level: 2, text: "A heading" },
        { kind: "paragraph", text: "A paragraph." },
        { kind: "table-cell", row: 3, text: "A cell" },
      ],
    }),
    true,
  );
  assert.equal(isValidExtractResult({ title: "", blocks: [] }), true);
});

test("anything else is page-unreadable rather than summarized", () => {
  for (const value of [
    null,
    undefined,
    "a string",
    {},
    { title: "t" },
    { blocks: [] },
    { title: 1, blocks: [] },
    { title: "t", blocks: {} },
    { title: "t", blocks: [{ kind: "unknown", text: "x" }] },
    { title: "t", blocks: [{ kind: "paragraph", text: 7 }] },
    { title: "t", blocks: [null] },
  ]) {
    assert.equal(isValidExtractResult(value), false, JSON.stringify(value));
  }
});

test("a RunState holds what the panel renders and nothing else", () => {
  const fields = ["phase", "title", "summary", "errorKind", "errorDetail"];
  for (const state of [
    idleState(),
    runningState("A title"),
    succeededState("A title", "A summary."),
    failedState("A title", ErrorKind.ENGINE_ERROR, EngineErrorDetail.REFUSED),
  ]) {
    assert.deepEqual(Object.keys(state).sort(), [...fields].sort());
  }
});

test("summary is empty except in succeeded, errorKind except in failed", () => {
  assert.equal(idleState().phase, "idle");
  assert.equal(runningState("t").summary, "");
  assert.equal(runningState("t").errorKind, "");
  assert.equal(succeededState("t", "s").summary, "s");
  assert.equal(succeededState("t", "s").errorKind, "");
  assert.equal(failedState("t", ErrorKind.TOKEN_MISSING).summary, "");
  assert.equal(failedState("t", ErrorKind.TOKEN_MISSING).errorKind, "token-missing");
  assert.equal(failedState("t", ErrorKind.TOKEN_MISSING).errorDetail, "");
});

test("running carries the title the click supplied", () => {
  assert.equal(runningState("A title").title, "A title");
  assert.equal(runningState("").title, "");
  assert.equal(runningState(undefined).title, "");
});

test("only live work blocks another run for the same tab", () => {
  assert.equal(claimRun(17), true);
  const firstRun = currentRun(17);
  assert.equal(claimRun(17), false);
  assert.equal(claimRun(18), true);

  releaseRun(17, firstRun);
  assert.equal(claimRun(17), true);
  const secondRun = currentRun(17);

  releaseRun(17, firstRun);
  assert.equal(isCurrentRun(17, secondRun), true);
  releaseRun(17, secondRun);
  releaseRun(18);
});

test("navigation invalidates work for its tab", () => {
  assert.equal(claimRun(23), true);
  const run = currentRun(23);

  invalidateRun(23);

  assert.equal(isCurrentRun(23, run), false);
  assert.equal(claimRun(23), true);
  releaseRun(23);
});

test("the panel messages cannot start a run", () => {
  assert.deepEqual(MessageType, {
    GET_STATE: "getState",
    STATE_CHANGED: "stateChanged",
  });
});

test("the panel displays state and settings without a run control", async () => {
  const [html, script] = await Promise.all([
    readFile(new URL("../src/panel/panel.html", import.meta.url), "utf8"),
    readFile(new URL("../src/panel/panel.js", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(html, /Summarize this page|id="run"/);
  assert.doesNotMatch(script, /MessageType\.RUN|runSummary/);
  assert.match(html, /id="settings"/);
  assert.match(script, /openOptionsPage/);
});

test("the toolbar action is the only normal run trigger", async () => {
  const worker = await readFile(
    new URL("../src/background/service_worker.js", import.meta.url),
    "utf8",
  );
  assert.equal(worker.match(/runSummary\(/g)?.length, 2);
  assert.match(worker, /chrome\.action\.onClicked\.addListener/);
  assert.doesNotMatch(worker, /message\.type === MessageType\.RUN/);
});

test("a normal page uses one page request", async () => {
  const calls = [];
  const answer = await summarizeMaterial(
    { title: "T", text: "A normal page.", charCount: 14 },
    INSTRUCTION,
    async (messages) => {
      calls.push(messages);
      return { ok: true, summary: "Done." };
    },
  );
  assert.deepEqual(answer, { ok: true, summary: "Done." });
  assert.equal(calls.length, 1);
  assert.match(calls[0][1].content, /^TASK: page/);
});

test("an invalidated run ignores an engine answer", async () => {
  let active = true;
  const answer = await summarizeMaterial(
    { title: "T", text: "A normal page.", charCount: 14 },
    INSTRUCTION,
    async () => {
      active = false;
      return { ok: true, summary: "Stale." };
    },
    0,
    () => active,
  );

  assert.equal(answer, null);
});

test("a long page summarizes every chunk and integrates them", async () => {
  const calls = [];
  const blocks = Array.from({ length: 4 }, (_, index) => ({
    kind: "paragraph",
    text: `${index} ${"substance ".repeat(12000)}`,
  }));
  const text = blocks.map((block) => block.text).join("\n\n");
  const answer = await summarizeMaterial(
    { title: "Long", text, blocks, charCount: text.length + 4 },
    INSTRUCTION,
    async (messages) => {
      calls.push(messages[1].content);
      return { ok: true, summary: `compressed ${calls.length}` };
    },
  );
  assert.equal(answer.ok, true);
  assert.ok(calls.filter((call) => call.startsWith("TASK: chunk")).length > 1);
  assert.equal(calls.at(-1).startsWith("TASK: integrate"), true);
});

test("large integration input is compressed in further stages", async () => {
  const calls = [];
  const text = "source ".repeat(MAX_REQUEST_MATERIAL_CHARS);
  const answer = await summarizeMaterial(
    { title: "Huge", text, charCount: text.length + 4 },
    INSTRUCTION,
    async (messages) => {
      calls.push(messages[1].content);
      return {
        ok: true,
        summary:
          calls.length < 10
            ? "summary ".repeat(MAX_REQUEST_MATERIAL_CHARS / 8)
            : "compressed",
      };
    },
  );
  assert.deepEqual(answer, { ok: true, summary: "compressed" });
  assert.ok(calls.filter((call) => call.startsWith("TASK: chunk")).length > 2);
  assert.equal(calls.at(-1).startsWith("TASK: integrate"), true);
});

test("one failed chunk fails the whole long-page run", async () => {
  let calls = 0;
  const text = "source ".repeat(MAX_REQUEST_MATERIAL_CHARS);
  const answer = await summarizeMaterial(
    { title: "Huge", text, charCount: text.length + 4 },
    INSTRUCTION,
    async () => {
      calls += 1;
      if (calls === 2) return { ok: false, kind: ErrorKind.ENGINE_TIMEOUT };
      return { ok: true, summary: "part" };
    },
  );
  assert.deepEqual(answer, { ok: false, kind: ErrorKind.ENGINE_TIMEOUT });
  assert.equal(calls, 2);
});

test("a failed state renders the message for its kind", () => {
  const state = failedState("t", ErrorKind.TOKEN_MISSING);
  assert.equal(
    messageFor(state.errorKind, state.errorDetail),
    "No API token is configured. Open Settings and enter your Sakura AI Engine token.",
  );
});
