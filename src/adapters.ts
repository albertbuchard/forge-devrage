import { createReadStream, existsSync, statSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline/promises";
import fg from "fast-glob";
import type { ConversationMessage, ConversationRecord, DevrageSource, MessageRole, ReaderWarning } from "./types.js";

const require = createRequire(import.meta.url);

export interface AdapterOptions {
  root?: string;
}

export interface AdapterReadResult {
  conversations: ConversationRecord[];
  warnings: ReaderWarning[];
}

export interface Adapter {
  source: DevrageSource;
  read(options?: AdapterOptions): Promise<AdapterReadResult>;
}

type UnknownRecord = Record<string, unknown>;

const ADAPTER_FACTORIES: Record<string, () => Adapter> = {
  amp: () => jsonThreadAdapter("amp", [join(dataHome(), "amp", "threads", "*.json")]),
  claude: claudeAdapter,
  cline: clineAdapter,
  codex: codexAdapter,
  hermes: () =>
    genericLocalLogAdapter("hermes", [
      join(homedir(), ".hermes", "**/*.{json,jsonl}"),
      join(homedir(), ".config", "hermes", "**/*.{json,jsonl}")
    ]),
  openclaw: () =>
    genericLocalLogAdapter("openclaw", [
      join(homedir(), ".openclaw", "**/*.{json,jsonl}"),
      join(homedir(), "Library", "Application Support", "OpenClaw", "**/*.{json,jsonl}")
    ]),
  opencode: opencodeAdapter,
  zed: zedAdapter
};

export function createAdapter(source: string): Adapter {
  const factory = ADAPTER_FACTORIES[source.toLowerCase()];
  if (!factory) {
    throw new Error(`unknown source: ${source} (available: ${availableSources().join(", ")})`);
  }
  return factory();
}

export function allAdapters(): Adapter[] {
  return availableSources().map((source) => createAdapter(source));
}

export function availableSources(): DevrageSource[] {
  return Object.keys(ADAPTER_FACTORIES).sort() as DevrageSource[];
}

export function normalizeRole(role: unknown): MessageRole {
  if (role === "assistant" || role === "user" || role === "developer" || role === "system") {
    return role;
  }
  return "unknown";
}

export function isContextInjection(role: MessageRole, text: string): boolean {
  if (role !== "user") {
    return false;
  }

  const trimmed = text.trimStart();
  return (
    trimmed.startsWith("<environment_context>") ||
    trimmed.startsWith("<permissions instructions>") ||
    trimmed.startsWith("# AGENTS.md instructions for ") ||
    (trimmed.includes("<environment_context>") && trimmed.includes("<INSTRUCTIONS>"))
  );
}

function codexAdapter(): Adapter {
  return {
    source: "codex",
    async read() {
      return readJsonlTree("codex", [
        join(homedir(), ".codex", "sessions"),
        join(homedir(), ".codex", "archived_sessions")
      ], parseCodexLine);
    }
  };
}

function claudeAdapter(): Adapter {
  return {
    source: "claude",
    async read() {
      return readJsonlTree("claude", [join(homedir(), ".claude", "projects")], parseClaudeLine);
    }
  };
}

function clineAdapter(): Adapter {
  return {
    source: "cline",
    async read() {
      const roots = getVSCodeGlobalStoragePaths()
        .flatMap((basePath) => [
          join(basePath, "saoudrizwan.claude-dev", "tasks"),
          join(basePath, "rooveterinaryinc.roo-cline", "tasks")
        ])
        .concat(join(homedir(), ".cline", "data", "tasks"));
      const conversations: ConversationRecord[] = [];
      const warnings: ReaderWarning[] = [];

      for (const root of roots) {
        if (!existsSync(root)) {
          continue;
        }

        const files = await fg(`${root.replace(/\/+$/, "")}/**/api_conversation_history.json`, {
          absolute: true,
          onlyFiles: true,
          unique: true,
          dot: true
        });

        for (const filePath of files) {
          try {
            const raw = await readFile(filePath, "utf8");
            const parsed = JSON.parse(raw) as unknown;
            if (!Array.isArray(parsed)) {
              continue;
            }
            const messages = parsed.flatMap((entry, index) =>
              compactMessage(parseGenericMessage(entry, {
                source: "cline",
                conversationId: basename(filePath.replace(/\/api_conversation_history\.json$/, "")),
                sourceFile: filePath,
                fallbackTimestamp: fileTimestamp(filePath),
                index
              }))
            );
            pushConversation(conversations, "cline", filePath, messages);
          } catch {
            warnings.push({ file: filePath, line: 0, reason: "Malformed Cline conversation skipped." });
          }
        }
      }

      return { conversations, warnings };
    }
  };
}

function opencodeAdapter(): Adapter {
  return {
    source: "opencode",
    async read() {
      const dbPath = findFirstExisting([
        join(dataHome(), "opencode", "opencode.db"),
        join(homedir(), "Library", "Application Support", "opencode", "opencode.db")
      ]);
      if (!dbPath) {
        return { conversations: [], warnings: [] };
      }

      const Database = loadBetterSqlite();
      if (!Database) {
        return {
          conversations: [],
          warnings: [{ file: dbPath, line: 0, reason: "better-sqlite3 unavailable; OpenCode database skipped." }]
        };
      }

      const bySession = new Map<string, ConversationMessage[]>();
      const db = new Database(dbPath, { readonly: true });
      try {
        const rows = db
          .prepare(
            `SELECT m.session_id AS sessionId,
                    m.time_created AS timeCreated,
                    json_extract(m.data, '$.role') AS role,
                    json_extract(p.data, '$.text') AS text
             FROM message m
             JOIN part p ON p.message_id = m.id
             WHERE json_extract(p.data, '$.type') = 'text'
             ORDER BY m.time_created ASC`
          )
          .all() as Array<{ sessionId: string; timeCreated: number; role: string; text: string | null }>;

        for (const row of rows) {
          const text = typeof row.text === "string" ? row.text.trim() : "";
          const role = normalizeRole(row.role);
          if (!text || isContextInjection(role, text)) {
            continue;
          }
          const conversationId = String(row.sessionId || "unknown");
          const message: ConversationMessage = {
            agent: "opencode",
            source: "opencode",
            conversationId,
            role,
            text,
            timestamp: new Date(row.timeCreated).toISOString(),
            sourceFile: dbPath
          };
          const messages = bySession.get(conversationId) ?? [];
          messages.push(message);
          bySession.set(conversationId, messages);
        }
      } finally {
        db.close();
      }

      return {
        conversations: [...bySession.entries()].map(([conversationId, messages]) => ({
          source: "opencode",
          conversationId,
          sourceFile: dbPath,
          updatedAt: maxTimestamp(messages) ?? fileTimestamp(dbPath),
          messages
        })),
        warnings: []
      };
    }
  };
}

function zedAdapter(): Adapter {
  return {
    source: "zed",
    async read() {
      const base =
        process.platform === "darwin"
          ? join(homedir(), "Library", "Application Support", "Zed")
          : join(dataHome(), "zed");
      const conversations: ConversationRecord[] = [];
      const warnings: ReaderWarning[] = [];
      const jsonFiles = await fg(join(base, "conversations", "*.json"), {
        absolute: true,
        onlyFiles: true,
        unique: true,
        dot: true
      });

      for (const filePath of jsonFiles) {
        try {
          const raw = await readFile(filePath, "utf8");
          const parsed = JSON.parse(raw) as UnknownRecord;
          const entries = Array.isArray(parsed.messages) ? parsed.messages : [];
          const messages = entries.flatMap((entry, index) =>
            compactMessage(parseGenericMessage(entry, {
              source: "zed",
              conversationId: basename(filePath, ".json"),
              sourceFile: filePath,
              fallbackTimestamp: fileTimestamp(filePath),
              index
            }))
          );
          pushConversation(conversations, "zed", filePath, messages);
        } catch {
          warnings.push({ file: filePath, line: 0, reason: "Malformed Zed conversation skipped." });
        }
      }

      return { conversations, warnings };
    }
  };
}

function jsonThreadAdapter(source: DevrageSource, patterns: string[]): Adapter {
  return {
    source,
    async read() {
      const files = await fg(patterns, {
        absolute: true,
        onlyFiles: true,
        unique: true,
        dot: true
      });
      const conversations: ConversationRecord[] = [];
      const warnings: ReaderWarning[] = [];

      for (const filePath of files) {
        try {
          const raw = await readFile(filePath, "utf8");
          const parsed = JSON.parse(raw) as UnknownRecord;
          const entries = Array.isArray(parsed.messages) ? parsed.messages : [];
          const messages = entries.flatMap((entry, index) =>
            compactMessage(parseGenericMessage(entry, {
              source,
              conversationId: basename(filePath, ".json"),
              sourceFile: filePath,
              fallbackTimestamp: fileTimestamp(filePath),
              index
            }))
          );
          pushConversation(conversations, source, filePath, messages);
        } catch {
          warnings.push({ file: filePath, line: 0, reason: `Malformed ${source} conversation skipped.` });
        }
      }

      return { conversations, warnings };
    }
  };
}

function genericLocalLogAdapter(source: DevrageSource, patterns: string[]): Adapter {
  return {
    source,
    async read() {
      const candidateFiles = await fg(patterns, {
        absolute: true,
        onlyFiles: true,
        unique: true,
        dot: true,
        ignore: ["**/node_modules/**", "**/.git/**", "**/venv/**", "**/__pycache__/**"]
      });
      const files = candidateFiles.filter((file) => /conversation|history|session|thread|transcript/i.test(file));
      const conversations: ConversationRecord[] = [];
      const warnings: ReaderWarning[] = [];

      for (const filePath of files) {
        if (filePath.endsWith(".jsonl")) {
          const result = await readJsonlFile(source, filePath, parseGenericJsonLine);
          conversations.push(...result.conversations);
          warnings.push(...result.warnings);
          continue;
        }

        try {
          const raw = await readFile(filePath, "utf8");
          const parsed = JSON.parse(raw) as unknown;
          const entries = extractMessageArray(parsed);
          const messages = entries.flatMap((entry, index) =>
            compactMessage(parseGenericMessage(entry, {
              source,
              conversationId: basename(filePath).replace(/\.[^.]+$/, ""),
              sourceFile: filePath,
              fallbackTimestamp: fileTimestamp(filePath),
              index
            }))
          );
          pushConversation(conversations, source, filePath, messages);
        } catch {
          warnings.push({ file: filePath, line: 0, reason: `Malformed ${source} log skipped.` });
        }
      }

      return { conversations, warnings };
    }
  };
}

async function readJsonlTree(
  source: DevrageSource,
  roots: string[],
  parser: JsonlParser
): Promise<AdapterReadResult> {
  const files = (
    await Promise.all(
      roots.map((root) =>
        fg(`${root.replace(/\/+$/, "")}/**/*.jsonl`, {
          absolute: true,
          onlyFiles: true,
          unique: true,
          dot: true
        })
      )
    )
  )
    .flat()
    .sort();

  const conversations: ConversationRecord[] = [];
  const warnings: ReaderWarning[] = [];

  for (const filePath of files) {
    const result = await readJsonlFile(source, filePath, parser);
    conversations.push(...result.conversations);
    warnings.push(...result.warnings);
  }

  return { conversations, warnings };
}

type JsonlParser = (
  record: unknown,
  context: {
    source: DevrageSource;
    conversationId: string;
    sourceFile: string;
    fallbackTimestamp: string;
    line: number;
  }
) => ConversationMessage | null;

async function readJsonlFile(
  source: DevrageSource,
  filePath: string,
  parser: JsonlParser
): Promise<AdapterReadResult> {
  const messages: ConversationMessage[] = [];
  const warnings: ReaderWarning[] = [];
  const fallbackTimestamp = fileTimestamp(filePath);
  const conversationId = basename(filePath, ".jsonl");
  const lines = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity
  });
  let lineNumber = 0;

  for await (const line of lines) {
    lineNumber += 1;
    if (!line.trim()) {
      continue;
    }

    try {
      const parsed = JSON.parse(line) as unknown;
      const message = parser(parsed, {
        source,
        conversationId,
        sourceFile: filePath,
        fallbackTimestamp,
        line: lineNumber
      });
      if (message) {
        messages.push(message);
      }
    } catch {
      warnings.push({ file: filePath, line: lineNumber, reason: "Invalid JSONL record skipped." });
    }
  }

  return {
    conversations:
      messages.length === 0
        ? []
        : [
            {
              source,
              conversationId,
              sourceFile: filePath,
              updatedAt: maxTimestamp(messages) ?? fallbackTimestamp,
              messages
            }
          ],
    warnings
  };
}

function parseCodexLine(record: unknown, context: Parameters<JsonlParser>[1]): ConversationMessage | null {
  if (!isObject(record) || record.type !== "response_item" || !isObject(record.payload)) {
    return null;
  }
  const payload = record.payload;
  if (payload.type !== "message") {
    return null;
  }
  const role = normalizeRole(payload.role);
  const text = extractText(payload.content).join("\n").trim();
  if (!text || isContextInjection(role, text)) {
    return null;
  }

  return {
    agent: "codex",
    source: "codex",
    conversationId: context.conversationId,
    role,
    text,
    timestamp: typeof record.timestamp === "string" ? record.timestamp : undefined,
    sourceFile: context.sourceFile
  };
}

function parseClaudeLine(record: unknown, context: Parameters<JsonlParser>[1]): ConversationMessage | null {
  if (!isObject(record)) {
    return null;
  }
  const role = normalizeRole(record.role ?? record.type);
  const message = isObject(record.message) ? record.message : record;
  const text = extractText(message.content ?? record.content).join("\n").trim();
  if (!text || isContextInjection(role, text)) {
    return null;
  }

  return {
    agent: "claude",
    source: "claude",
    conversationId: context.conversationId,
    role,
    text,
    timestamp:
      typeof record.timestamp === "string"
        ? record.timestamp
        : typeof record.createdAt === "string"
          ? record.createdAt
          : undefined,
    sourceFile: context.sourceFile
  };
}

function parseGenericJsonLine(record: unknown, context: Parameters<JsonlParser>[1]): ConversationMessage | null {
  return parseGenericMessage(record, {
    source: context.source,
    conversationId: context.conversationId,
    sourceFile: context.sourceFile,
    fallbackTimestamp: context.fallbackTimestamp,
    index: context.line
  });
}

function parseGenericMessage(
  entry: unknown,
  context: {
    source: DevrageSource;
    conversationId: string;
    sourceFile: string;
    fallbackTimestamp: string;
    index: number;
  }
): ConversationMessage | null {
  if (!isObject(entry)) {
    return null;
  }
  const message = isObject(entry.message) ? entry.message : entry;
  const role = normalizeRole(message.role ?? entry.role ?? entry.type);
  const text = extractText(message.content ?? entry.content ?? message.text ?? entry.text).join("\n").trim();
  if (!text || isContextInjection(role, text)) {
    return null;
  }
  const timestamp =
    stringTimestamp(entry.timestamp) ??
    stringTimestamp(entry.createdAt) ??
    stringTimestamp(message.timestamp) ??
    numberTimestamp(entry.ts) ??
    numberTimestamp(message.ts) ??
    context.fallbackTimestamp;

  return {
    agent: context.source,
    source: context.source,
    conversationId: context.conversationId,
    role,
    text,
    timestamp,
    sourceFile: context.sourceFile
  };
}

function compactMessage(message: ConversationMessage | null): ConversationMessage[] {
  return message ? [message] : [];
}

function extractMessageArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (!isObject(value)) {
    return [];
  }
  for (const key of ["messages", "conversation", "turns", "items", "history"]) {
    const candidate = value[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }
  return [];
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
  const direct = content.text ?? content.value;
  if (typeof direct === "string") {
    return [direct];
  }
  if (content.content !== undefined) {
    return extractText(content.content);
  }
  return [];
}

function pushConversation(
  conversations: ConversationRecord[],
  source: DevrageSource,
  filePath: string,
  messages: ConversationMessage[]
): void {
  if (messages.length === 0) {
    return;
  }
  conversations.push({
    source,
    conversationId: messages[0]?.conversationId ?? basename(filePath).replace(/\.[^.]+$/, ""),
    sourceFile: filePath,
    updatedAt: maxTimestamp(messages) ?? fileTimestamp(filePath),
    messages
  });
}

function maxTimestamp(messages: ConversationMessage[]): string | null {
  let max = Number.NEGATIVE_INFINITY;
  let value: string | null = null;
  for (const message of messages) {
    if (!message.timestamp) {
      continue;
    }
    const timestamp = Date.parse(message.timestamp);
    if (Number.isFinite(timestamp) && timestamp > max) {
      max = timestamp;
      value = new Date(timestamp).toISOString();
    }
  }
  return value;
}

function fileTimestamp(filePath: string): string {
  try {
    return statSync(filePath).mtime.toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

function dataHome(): string {
  return process.env["XDG_DATA_HOME"] ?? join(homedir(), ".local", "share");
}

function getVSCodeGlobalStoragePaths(): string[] {
  if (process.platform === "darwin") {
    return [
      join(homedir(), "Library", "Application Support", "Code", "User", "globalStorage"),
      join(homedir(), "Library", "Application Support", "Code - Insiders", "User", "globalStorage"),
      join(homedir(), "Library", "Application Support", "Cursor", "User", "globalStorage")
    ];
  }
  if (process.platform === "linux") {
    const configBase = process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config");
    return [
      join(configBase, "Code", "User", "globalStorage"),
      join(configBase, "Code - Insiders", "User", "globalStorage"),
      join(configBase, "Cursor", "User", "globalStorage")
    ];
  }
  const appData = process.env["APPDATA"] ?? join(homedir(), "AppData", "Roaming");
  return [
    join(appData, "Code", "User", "globalStorage"),
    join(appData, "Code - Insiders", "User", "globalStorage")
  ];
}

function findFirstExisting(paths: string[]): string | null {
  return paths.find((path) => existsSync(path)) ?? null;
}

function loadBetterSqlite(): any {
  try {
    return require("better-sqlite3");
  } catch {
    return null;
  }
}

function stringTimestamp(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function numberTimestamp(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const ms = value > 10_000_000_000 ? value : value * 1000;
  return new Date(ms).toISOString();
}

function isObject(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}
