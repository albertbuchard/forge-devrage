import type {
  ActualWordStats,
  AnalyzeOptions,
  ConversationMessage,
  ConversationRecord,
  ConversationStats,
  DailyStats,
  DevrageReport,
  SourceStats,
  WordStats
} from "./types.js";
import { buildLexiconIndexes } from "./swears.js";

const tokenPattern = /[a-z][a-z0-9'*_-]*/gi;

interface TokenMatch {
  token: string;
  start: number;
  end: number;
}

interface CountedOccurrence {
  root: string;
  variant: string;
  actual: string;
}

interface TextRange {
  start: number;
  end: number;
}

export function analyzeConversations(
  conversations: ConversationRecord[],
  options: AnalyzeOptions,
  generatedAt = new Date().toISOString()
): DevrageReport {
  const { tokenIndex, phraseVariants } = buildLexiconIndexes();
  const agentStats = new Map<string, { messages: number; messagesWithSwears: number; swears: number }>();
  const sourceStats = new Map<string, SourceStats>();
  const wordStats = new Map<string, WordStats>();
  const actualWordStats = new Map<string, ActualWordStats>();
  const filesScanned = new Set<string>();
  const conversationStats: ConversationStats[] = [];

  let messagesScanned = 0;
  let messagesWithSwears = 0;
  let totalSwears = 0;

  for (const conversation of conversations) {
    if (!isConversationInDateRange(conversation, options)) {
      continue;
    }

    filesScanned.add(conversation.sourceFile);

    const dateKey = dayKey(conversation.updatedAt, options.timeZone);
    let conversationMessages = 0;
    let conversationMessagesWithSwears = 0;
    let conversationSwears = 0;

    const source = conversation.source;
    const currentSource =
      sourceStats.get(source) ?? {
        source,
        conversations: 0,
        messages: 0,
        messagesWithSwears: 0,
        swears: 0
      };
    currentSource.conversations += 1;

    for (const message of conversation.messages) {
      if (!options.roles.has(message.role)) {
        continue;
      }

      messagesScanned += 1;
      conversationMessages += 1;
      currentSource.messages += 1;

      const agent = normalizeAgent(message.agent);
      const currentAgent = agentStats.get(agent) ?? {
        messages: 0,
        messagesWithSwears: 0,
        swears: 0
      };
      currentAgent.messages += 1;

      let swearsInMessage = 0;

      for (const occurrence of findOccurrences(message.text, tokenIndex, phraseVariants)) {
        swearsInMessage += 1;
        totalSwears += 1;
        conversationSwears += 1;
        currentSource.swears += 1;
        addOccurrence(wordStats, actualWordStats, occurrence);
      }

      if (swearsInMessage > 0) {
        messagesWithSwears += 1;
        conversationMessagesWithSwears += 1;
        currentSource.messagesWithSwears += 1;
        currentAgent.messagesWithSwears += 1;
        currentAgent.swears += swearsInMessage;
      }

      agentStats.set(agent, currentAgent);
    }

    sourceStats.set(source, currentSource);
    conversationStats.push({
      source,
      conversationId: conversation.conversationId,
      project: conversation.project,
      sourceFile: conversation.sourceFile,
      updatedAt: conversation.updatedAt,
      dateKey,
      messages: conversationMessages,
      messagesWithSwears: conversationMessagesWithSwears,
      swears: conversationSwears
    });
  }

  const daily = buildDailyStats(conversationStats);

  return {
    generatedAt,
    filesScanned: [...filesScanned].sort(),
    conversationsScanned: conversationStats.length,
    messagesScanned,
    messagesWithSwears,
    totalSwears,
    byAgent: [...agentStats.entries()]
      .map(([agent, stats]) => ({ agent, ...stats }))
      .sort(
        (left, right) =>
          right.swears - left.swears ||
          right.messages - left.messages ||
          left.agent.localeCompare(right.agent)
      ),
    bySource: [...sourceStats.values()].sort(
      (left, right) =>
        right.swears - left.swears ||
        right.messages - left.messages ||
        left.source.localeCompare(right.source)
    ),
    conversations: conversationStats.sort(
      (left, right) =>
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
        left.source.localeCompare(right.source) ||
        left.conversationId.localeCompare(right.conversationId)
    ),
    daily,
    topWords: [...wordStats.values()].sort(
      (left, right) => right.count - left.count || left.root.localeCompare(right.root)
    ),
    actualWords: [...actualWordStats.values()].sort(
      (left, right) =>
        right.count - left.count ||
        left.word.localeCompare(right.word) ||
        left.root.localeCompare(right.root)
    ),
    warnings: [],
    roleFilter: [...options.roles].sort(),
    sourceFilter: [],
    dateFilter: {
      date: options.date,
      since: options.since?.toISOString(),
      until: options.until?.toISOString()
    }
  };
}

export function analyzeMessages(
  messages: ConversationMessage[],
  options: AnalyzeOptions,
  generatedAt = new Date().toISOString()
): DevrageReport {
  const conversationsByKey = new Map<string, ConversationRecord>();

  for (const message of messages) {
    const key = `${message.source}\u0000${message.conversationId}\u0000${message.sourceFile}`;
    const current =
      conversationsByKey.get(key) ??
      {
        source: message.source,
        conversationId: message.conversationId,
        sourceFile: message.sourceFile,
        updatedAt: message.timestamp ?? generatedAt,
        messages: []
      };
    current.messages.push(message);
    if (message.timestamp && Date.parse(message.timestamp) > Date.parse(current.updatedAt)) {
      current.updatedAt = message.timestamp;
    }
    conversationsByKey.set(key, current);
  }

  return analyzeConversations([...conversationsByKey.values()], options, generatedAt);
}

export function tokenize(text: string): string[] {
  return tokenizeWithSpans(text).map((match) => match.token);
}

export function dayKey(value: string, timeZone?: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10);
  }

  if (!timeZone) {
    return date.toISOString().slice(0, 10);
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : date.toISOString().slice(0, 10);
}

function isConversationInDateRange(conversation: ConversationRecord, options: AnalyzeOptions): boolean {
  const updatedAtMs = Date.parse(conversation.updatedAt);
  if (!Number.isFinite(updatedAtMs)) {
    return false;
  }

  if (options.date && dayKey(conversation.updatedAt, options.timeZone) !== options.date) {
    return false;
  }

  if (options.since && updatedAtMs < options.since.getTime()) {
    return false;
  }

  if (options.until && updatedAtMs >= options.until.getTime()) {
    return false;
  }

  return true;
}

function buildDailyStats(conversations: ConversationStats[]): DailyStats[] {
  const byDay = new Map<string, DailyStats>();

  for (const conversation of conversations) {
    const current =
      byDay.get(conversation.dateKey) ??
      {
        dateKey: conversation.dateKey,
        conversations: 0,
        messages: 0,
        messagesWithSwears: 0,
        swears: 0,
        swearingMessagePercent: 0
      };
    current.conversations += 1;
    current.messages += conversation.messages;
    current.messagesWithSwears += conversation.messagesWithSwears;
    current.swears += conversation.swears;
    current.swearingMessagePercent =
      current.messages === 0 ? 0 : (current.messagesWithSwears / current.messages) * 100;
    byDay.set(conversation.dateKey, current);
  }

  return [...byDay.values()].sort((left, right) => right.dateKey.localeCompare(left.dateKey));
}

function findOccurrences(
  text: string,
  tokenIndex: Map<string, string>,
  phraseVariants: ReturnType<typeof buildLexiconIndexes>["phraseVariants"]
): CountedOccurrence[] {
  const occurrences: CountedOccurrence[] = [];
  const phraseRanges: TextRange[] = [];

  for (const phrase of phraseVariants) {
    phrase.pattern.lastIndex = 0;

    for (const match of text.matchAll(phrase.pattern)) {
      const matchedText = match[0];
      const start = match.index ?? 0;
      const end = start + matchedText.length;

      if (!/[\s-]/.test(matchedText) && tokenIndex.has(normalizeToken(matchedText))) {
        continue;
      }

      if (overlapsAny({ start, end }, phraseRanges)) {
        continue;
      }

      phraseRanges.push({ start, end });
      occurrences.push({
        root: phrase.root,
        variant: phrase.variant,
        actual: normalizeActualPhrase(matchedText)
      });
    }
  }

  for (const match of tokenizeWithSpans(text)) {
    if (overlapsAny(match, phraseRanges)) {
      continue;
    }

    const root = tokenIndex.get(match.token);
    if (!root) {
      continue;
    }

    occurrences.push({ root, variant: match.token, actual: match.token });
  }

  return occurrences;
}

function tokenizeWithSpans(text: string): TokenMatch[] {
  const matches: TokenMatch[] = [];
  tokenPattern.lastIndex = 0;

  for (const match of text.matchAll(tokenPattern)) {
    const rawToken = match[0];
    const token = normalizeToken(rawToken);

    if (!token) {
      continue;
    }

    const start = match.index ?? 0;
    matches.push({ token, start, end: start + rawToken.length });
  }

  return matches;
}

function addOccurrence(
  wordStats: Map<string, WordStats>,
  actualWordStats: Map<string, ActualWordStats>,
  occurrence: CountedOccurrence
): void {
  const currentWord = wordStats.get(occurrence.root) ?? {
    root: occurrence.root,
    count: 0,
    variants: {}
  };
  currentWord.count += 1;
  currentWord.variants[occurrence.variant] = (currentWord.variants[occurrence.variant] ?? 0) + 1;
  wordStats.set(occurrence.root, currentWord);

  const actualKey = `${occurrence.root}\u0000${occurrence.actual}`;
  const currentActual = actualWordStats.get(actualKey) ?? {
    word: occurrence.actual,
    root: occurrence.root,
    count: 0
  };
  currentActual.count += 1;
  actualWordStats.set(actualKey, currentActual);
}

function overlapsAny(range: TextRange, ranges: TextRange[]): boolean {
  return ranges.some((other) => range.start < other.end && range.end > other.start);
}

function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .replaceAll("*", "")
    .replaceAll("_", "")
    .replaceAll("-", "")
    .replace(/^'+|'+$/g, "");
}

function normalizeActualPhrase(phrase: string): string {
  return phrase.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeAgent(agent: string): string {
  return agent.trim().toLowerCase() || "unknown";
}
