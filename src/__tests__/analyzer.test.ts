import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeMessages } from "../analyzer.js";
import type { ConversationMessage, MessageRole } from "../types.js";

function message(role: MessageRole, text: string): ConversationMessage {
  return {
    agent: "codex",
    source: "codex",
    conversationId: "sample",
    role,
    text,
    timestamp: "2026-05-09T00:00:00.000Z",
    sourceFile: "sample.jsonl"
  };
}

test("groups variants under root words and avoids substring matches", () => {
  const messages: ConversationMessage[] = [
    message("assistant", "This is fucking hard, but the assistant label and assistance should not count."),
    message("assistant", "What a bullshit mess. wtf.")
  ];

  const report = analyzeMessages(messages, { roles: new Set(["assistant"]) }, "2026-05-09T00:00:00.000Z");

  assert.equal(report.messagesScanned, 2);
  assert.equal(report.totalSwears, 3);
  assert.equal(report.topWords.find((word) => word.root === "fuck")?.variants.fucking, 1);
  assert.equal(report.actualWords.find((word) => word.word === "fucking")?.count, 1);
  assert.equal(report.topWords.find((word) => word.root === "ass"), undefined);
});

test("filters roles before counting messages", () => {
  const messages: ConversationMessage[] = [
    message("assistant", "damn"),
    message("user", "damn")
  ];

  const report = analyzeMessages(messages, { roles: new Set(["assistant"]) }, "2026-05-09T00:00:00.000Z");

  assert.equal(report.messagesScanned, 1);
  assert.equal(report.totalSwears, 1);
});

test("counts phrase variants without double-counting the token inside the phrase", () => {
  const messages: ConversationMessage[] = [
    message("user", "This is a piece of crap, not just random crappy output.")
  ];

  const report = analyzeMessages(messages, { roles: new Set(["user"]) }, "2026-05-09T00:00:00.000Z");
  const crap = report.topWords.find((word) => word.root === "crap");

  assert.equal(report.totalSwears, 2);
  assert.equal(crap?.count, 2);
  assert.equal(crap?.variants["piece of crap"], 1);
  assert.equal(crap?.variants.crap, undefined);
  assert.equal(crap?.variants.crappy, 1);
  assert.deepEqual(
    report.actualWords.map((word) => [word.word, word.root, word.count]),
    [
      ["crappy", "crap", 1],
      ["piece of crap", "crap", 1]
    ]
  );
});

test("counts phrase variants when angry spacing disappears", () => {
  const messages: ConversationMessage[] = [
    message("user", "pieceofcrap piece-of-crap dumbass dumb ass")
  ];

  const report = analyzeMessages(messages, { roles: new Set(["user"]) }, "2026-05-09T00:00:00.000Z");

  assert.equal(report.totalSwears, 4);
  assert.equal(report.topWords.find((word) => word.root === "crap")?.count, 2);
  assert.equal(report.actualWords.find((word) => word.word === "pieceofcrap")?.count, 1);
  assert.equal(report.actualWords.find((word) => word.word === "piece-of-crap")?.count, 1);
  assert.equal(report.topWords.find((word) => word.root === "ass")?.count, 2);
  assert.equal(report.actualWords.find((word) => word.word === "dumbass")?.count, 1);
  assert.equal(report.actualWords.find((word) => word.word === "dumb ass")?.count, 1);
});

test("counts user-observed typo and insult variants", () => {
  const messages: ConversationMessage[] = [
    message("user", "ashole morno trash garbage stupid dumb sucks")
  ];

  const report = analyzeMessages(messages, { roles: new Set(["user"]) }, "2026-05-09T00:00:00.000Z");

  assert.equal(report.totalSwears, 7);
  assert.equal(report.topWords.find((word) => word.root === "ass")?.variants.ashole, 1);
  assert.equal(report.topWords.find((word) => word.root === "moron")?.variants.morno, 1);
  assert.equal(report.topWords.find((word) => word.root === "trash")?.count, 1);
  assert.equal(report.topWords.find((word) => word.root === "garbage")?.count, 1);
});

test("does not leak regex cursor state across messages", () => {
  const messages: ConversationMessage[] = [
    message("user", "fucking"),
    message("user", "fucking"),
    message("user", "fucking")
  ];

  const report = analyzeMessages(messages, { roles: new Set(["user"]) }, "2026-05-09T00:00:00.000Z");

  assert.equal(report.totalSwears, 3);
  assert.equal(report.topWords.find((word) => word.root === "fuck")?.variants.fucking, 3);
});

test("normalizes token casing", () => {
  const messages: ConversationMessage[] = [
    message("user", "FUCKING Ashole MORNO")
  ];

  const report = analyzeMessages(messages, { roles: new Set(["user"]) }, "2026-05-09T00:00:00.000Z");

  assert.equal(report.totalSwears, 3);
  assert.equal(report.topWords.find((word) => word.root === "fuck")?.variants.fucking, 1);
  assert.equal(report.topWords.find((word) => word.root === "ass")?.variants.ashole, 1);
  assert.equal(report.topWords.find((word) => word.root === "moron")?.variants.morno, 1);
});

test("filters whole conversations by updated date", () => {
  const report = analyzeMessages(
    [
      { ...message("user", "fuck"), conversationId: "old", timestamp: "2026-05-08T10:00:00.000Z" },
      { ...message("user", "damn"), conversationId: "new", timestamp: "2026-05-09T10:00:00.000Z" }
    ],
    { roles: new Set(["user"]), date: "2026-05-09", timeZone: "UTC" },
    "2026-05-10T00:00:00.000Z"
  );

  assert.equal(report.conversationsScanned, 1);
  assert.equal(report.messagesScanned, 1);
  assert.equal(report.totalSwears, 1);
  assert.equal(report.conversations[0]?.conversationId, "new");
  assert.equal(report.daily[0]?.dateKey, "2026-05-09");
});
