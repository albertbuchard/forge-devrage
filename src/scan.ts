import { analyzeConversations } from "./analyzer.js";
import { allAdapters, createAdapter, availableSources } from "./adapters.js";
import type {
  ConversationRecord,
  DevrageReport,
  DevrageSource,
  MessageRole,
  ReaderWarning
} from "./types.js";

export interface ScanOptions {
  roles: Set<MessageRole>;
  sources?: Set<DevrageSource>;
  date?: string;
  since?: Date;
  until?: Date;
  timeZone?: string;
}

export async function scanConversations(options: ScanOptions): Promise<DevrageReport> {
  const adapters = options.sources?.size
    ? [...options.sources].map((source) => createAdapter(source))
    : allAdapters();
  const conversations: ConversationRecord[] = [];
  const warnings: ReaderWarning[] = [];

  for (const adapter of adapters) {
    const result = await adapter.read();
    conversations.push(...result.conversations);
    warnings.push(...result.warnings);
  }

  const report = analyzeConversations(conversations, options);
  report.warnings = warnings;
  report.sourceFilter = adapters.map((adapter) => adapter.source).sort();
  return report;
}

export async function scanConversationFiles(
  _inputs: string[],
  options: {
    roles: Set<MessageRole>;
    date?: string;
    since?: Date;
    until?: Date;
    timeZone?: string;
  }
): Promise<DevrageReport> {
  return scanConversations(options);
}

export { availableSources };
