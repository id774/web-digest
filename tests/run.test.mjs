import test from "node:test";
import assert from "node:assert/strict";

import {
  composeMessages,
  failedState,
  idleState,
  isValidExtractResult,
  runningState,
  succeededState,
} from "../src/background/service_worker.js";
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
  assert.equal(messages[1].content, "TITLE: A title\n\nBODY:\nA paragraph.");
});

test("an empty title omits the TITLE line", () => {
  const messages = composeMessages(INSTRUCTION, {
    title: "",
    text: "A paragraph.",
    charCount: 12,
    blockCount: 1,
  });
  assert.equal(messages[1].content, "BODY:\nA paragraph.");
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

test("the three message names are fixed", () => {
  assert.deepEqual(MessageType, {
    GET_STATE: "getState",
    RUN: "run",
    STATE_CHANGED: "stateChanged",
  });
});

test("a failed state renders the message for its kind", () => {
  const state = failedState("t", ErrorKind.TOKEN_MISSING);
  assert.equal(
    messageFor(state.errorKind, state.errorDetail),
    "No API token is configured. Open Settings and enter your Sakura AI Engine token.",
  );
});
