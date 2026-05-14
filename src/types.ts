export type MessageRole = "assistant" | "user" | "developer" | "system" | "unknown";

export type DevrageSource =
  | "amp"
  | "claude"
  | "cline"
  | "codex"
  | "hermes"
  | "openclaw"
  | "opencode"
  | "zed"
  | "unknown";

export interface ConversationMessage {
  agent: string;
  source: DevrageSource;
  conversationId: string;
  role: MessageRole;
  text: string;
  timestamp?: string;
  sourceFile: string;
}

export interface ConversationRecord {
  source: DevrageSource;
  conversationId: string;
  project?: string;
  sourceFile: string;
  updatedAt: string;
  messages: ConversationMessage[];
}

export interface ReaderWarning {
  file: string;
  line: number;
  reason: string;
}

export interface ReadResult {
  messages: ConversationMessage[];
  warnings: ReaderWarning[];
  files: string[];
}

export interface AgentStats {
  agent: string;
  messages: number;
  messagesWithSwears: number;
  swears: number;
}

export interface SourceStats {
  source: DevrageSource;
  conversations: number;
  messages: number;
  messagesWithSwears: number;
  swears: number;
}

export interface ConversationStats {
  source: DevrageSource;
  conversationId: string;
  sourceFile: string;
  project?: string;
  updatedAt: string;
  dateKey: string;
  messages: number;
  messagesWithSwears: number;
  swears: number;
}

export interface DailyStats {
  dateKey: string;
  conversations: number;
  messages: number;
  messagesWithSwears: number;
  swears: number;
  swearingMessagePercent: number;
}

export interface WordStats {
  root: string;
  count: number;
  variants: Record<string, number>;
}

export interface ActualWordStats {
  word: string;
  root: string;
  count: number;
}

export interface DevrageReport {
  generatedAt: string;
  filesScanned: string[];
  conversationsScanned: number;
  messagesScanned: number;
  messagesWithSwears: number;
  totalSwears: number;
  byAgent: AgentStats[];
  bySource: SourceStats[];
  conversations: ConversationStats[];
  daily: DailyStats[];
  topWords: WordStats[];
  actualWords: ActualWordStats[];
  warnings: ReaderWarning[];
  roleFilter: MessageRole[];
  sourceFilter: DevrageSource[];
  dateFilter: {
    date?: string;
    since?: string;
    until?: string;
  };
}

export interface AnalyzeOptions {
  roles: Set<MessageRole>;
  date?: string;
  since?: Date;
  until?: Date;
  timeZone?: string;
}
