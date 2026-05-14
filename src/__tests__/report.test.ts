import assert from "node:assert/strict";
import { test } from "node:test";
import { renderTextReport } from "../report.js";
import type { DevrageReport } from "../types.js";

test("renders the compact devrage terminal report", () => {
  const report: DevrageReport = {
    generatedAt: "2026-05-09T00:00:00.000Z",
    filesScanned: ["sample.jsonl"],
    conversationsScanned: 1,
    messagesScanned: 2,
    messagesWithSwears: 1,
    totalSwears: 2,
    byAgent: [{ agent: "codex", messages: 2, messagesWithSwears: 1, swears: 2 }],
    bySource: [{ source: "codex", conversations: 1, messages: 2, messagesWithSwears: 1, swears: 2 }],
    conversations: [
      {
        source: "codex",
        conversationId: "sample",
        sourceFile: "sample.jsonl",
        updatedAt: "2026-05-09T00:00:00.000Z",
        dateKey: "2026-05-09",
        messages: 2,
        messagesWithSwears: 1,
        swears: 2
      }
    ],
    daily: [
      {
        dateKey: "2026-05-09",
        conversations: 1,
        messages: 2,
        messagesWithSwears: 1,
        swears: 2,
        swearingMessagePercent: 50
      }
    ],
    topWords: [{ root: "fuck", count: 2, variants: { fuck: 1, fucking: 1 } }],
    actualWords: [
      { word: "fuck", root: "fuck", count: 1 },
      { word: "fucking", root: "fuck", count: 1 }
    ],
    warnings: [],
    roleFilter: ["user"],
    sourceFilter: ["codex"],
    dateFilter: {}
  };

  const rendered = renderTextReport(report, { color: false, maxActualWords: 8 });

  assert.match(rendered, /forge-devrage report/);
  assert.match(rendered, /messages scanned:\s+2/);
  assert.match(rendered, /codex\s+2 swears in\s+2 messages \(50\.0% swearing\)/);
  assert.match(rendered, /root words:\n\s+fuck\s+2/);
  assert.match(rendered, /actual words:\n\s+fuck\s+1\n\s+fucking\s+1 \(fuck\)/);
});

test("says when actual words are truncated", () => {
  const report: DevrageReport = {
    generatedAt: "2026-05-09T00:00:00.000Z",
    filesScanned: ["sample.jsonl"],
    conversationsScanned: 1,
    messagesScanned: 1,
    messagesWithSwears: 1,
    totalSwears: 2,
    byAgent: [{ agent: "codex", messages: 1, messagesWithSwears: 1, swears: 2 }],
    bySource: [{ source: "codex", conversations: 1, messages: 1, messagesWithSwears: 1, swears: 2 }],
    conversations: [
      {
        source: "codex",
        conversationId: "sample",
        sourceFile: "sample.jsonl",
        updatedAt: "2026-05-09T00:00:00.000Z",
        dateKey: "2026-05-09",
        messages: 1,
        messagesWithSwears: 1,
        swears: 2
      }
    ],
    daily: [
      {
        dateKey: "2026-05-09",
        conversations: 1,
        messages: 1,
        messagesWithSwears: 1,
        swears: 2,
        swearingMessagePercent: 100
      }
    ],
    topWords: [{ root: "fuck", count: 2, variants: { fuck: 1, fucking: 1 } }],
    actualWords: [
      { word: "fuck", root: "fuck", count: 1 },
      { word: "fucking", root: "fuck", count: 1 }
    ],
    warnings: [],
    roleFilter: ["user"],
    sourceFilter: ["codex"],
    dateFilter: {}
  };

  const rendered = renderTextReport(report, { color: false, maxActualWords: 1 });

  assert.match(rendered, /1 more; rerun with --max-actual-words 2/);
});
