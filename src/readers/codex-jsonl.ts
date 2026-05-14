import { createReadStream } from "node:fs";
import { basename } from "node:path";
import { createInterface } from "node:readline/promises";
import { isContextInjection } from "../adapters.js";
import type { ConversationMessage, MessageRole, ReaderWarning } from "../types.js";

interface CodexLine {
  timestamp?: string;
  type?: string;
  payload?: unknown;
}

interface CodexPayload {
  type?: string;
  role?: string;
  content?: unknown;
}

export interface CodexReadOptions {
  agentOverride?: string;
}

export async function readCodexJsonlFile(
  filePath: string,
  options: CodexReadOptions = {}
): Promise<{ messages: ConversationMessage[]; warnings: ReaderWarning[] }> {
  const messages: ConversationMessage[] = [];
  const warnings: ReaderWarning[] = [];
  const file = createReadStream(filePath, { encoding: "utf8" });
  const lines = createInterface({ input: file, crlfDelay: Infinity });
  const agent = options.agentOverride ?? inferAgentFromPath(filePath);

  let lineNumber = 0;

  for await (const line of lines) {
    lineNumber += 1;

    if (line.trim().length === 0) {
      continue;
    }

    let parsed: CodexLine;
    try {
      parsed = JSON.parse(line) as CodexLine;
    } catch {
      warnings.push({ file: filePath, line: lineNumber, reason: "Invalid JSONL record skipped." });
      continue;
    }

    const message = parseCodexMessage(parsed, filePath, agent);
    if (message) {
      messages.push(message);
    }
  }

  return { messages, warnings };
}

export function parseCodexMessage(record: CodexLine, sourceFile = "inline.jsonl", agent = "codex"): ConversationMessage | null {
  if (record.type !== "response_item" || !isObject(record.payload)) {
    return null;
  }

  const payload = record.payload as CodexPayload;
  if (payload.type !== "message") {
    return null;
  }

  const role = normalizeRole(payload.role);
  const text = extractText(payload.content).join("\n").trim();
  if (!text || isContextInjection(role, text)) {
    return null;
  }

  return {
    agent,
    source: "codex",
    conversationId: basename(sourceFile).replace(/\.jsonl$/, "") || "inline",
    role,
    text,
    timestamp: record.timestamp,
    sourceFile
  };
}

export function extractText(content: unknown): string[] {
  if (typeof content === "string") {
    return [content];
  }

  if (Array.isArray(content)) {
    return content.flatMap((item) => extractText(item));
  }

  if (!isObject(content)) {
    return [];
  }

  const maybeText = content["text"];
  if (typeof maybeText === "string") {
    return [maybeText];
  }

  const maybeContent = content["content"];
  if (maybeContent !== undefined) {
    return extractText(maybeContent);
  }

  return [];
}

function normalizeRole(role: unknown): MessageRole {
  if (role === "assistant" || role === "user" || role === "developer" || role === "system") {
    return role;
  }

  return "unknown";
}

function inferAgentFromPath(filePath: string): string {
  const normalized = filePath.toLowerCase();

  if (normalized.includes("/.codex/")) {
    return "codex";
  }

  if (normalized.includes("/.claude/")) {
    return "claude";
  }

  if (normalized.includes("/.opencode/")) {
    return "opencode";
  }

  if (normalized.includes("/.amp/")) {
    return "amp";
  }

  return basename(filePath).replace(/\.[^.]+$/, "") || "unknown";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
