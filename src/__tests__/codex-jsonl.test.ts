import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCodexMessage } from "../readers/codex-jsonl.js";

test("extracts assistant text from Codex response_item messages", () => {
  const message = parseCodexMessage(
    {
      timestamp: "2026-05-09T12:00:00.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "damn, that failed" }]
      }
    },
    "sample.jsonl",
    "codex"
  );

  assert.equal(message?.role, "assistant");
  assert.equal(message?.text, "damn, that failed");
  assert.equal(message?.agent, "codex");
  assert.equal(message?.source, "codex");
});

test("ignores non-message response items", () => {
  const message = parseCodexMessage({
    type: "response_item",
    payload: {
      type: "function_call",
      name: "exec_command"
    }
  });

  assert.equal(message, null);
});

test("ignores injected Codex context user records", () => {
  const message = parseCodexMessage({
    timestamp: "2026-05-09T12:00:00.000Z",
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "<environment_context>\n  <cwd>/tmp</cwd>\n</environment_context>" }]
    }
  });

  assert.equal(message, null);
});
