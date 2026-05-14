import pc from "picocolors";
import type { ActualWordStats, AgentStats, DevrageReport, WordStats } from "./types.js";

export type ReportFormat = "text" | "json" | "markdown";

export interface RenderOptions {
  color: boolean;
  maxActualWords: number;
}

export function renderReport(report: DevrageReport, format: ReportFormat, options: RenderOptions): string {
  if (format === "json") {
    return `${JSON.stringify(report, null, 2)}\n`;
  }

  if (format === "markdown") {
    return renderMarkdownReport(report, options);
  }

  return renderTextReport(report, options);
}

export function renderTextReport(report: DevrageReport, options: RenderOptions): string {
  const color = options.color ? pc : noColor;
  const lines: string[] = [];
  const title = "forge-devrage report";
  const agentWidth = Math.max(5, ...report.byAgent.map((agent) => agent.agent.length));
  const sourceWidth = Math.max(6, ...report.bySource.map((source) => source.source.length));
  const wordWidth = Math.max(4, ...report.topWords.map((word) => word.root.length));
  const actualWordWidth = Math.max(4, ...report.actualWords.map((word) => word.word.length));

  lines.push(color.bold(title));
  lines.push(color.dim("=".repeat(title.length)));
  lines.push("");
  lines.push(`conversations:     ${report.conversationsScanned}`);
  lines.push(`messages scanned:  ${report.messagesScanned}`);
  lines.push(`messages w/swears: ${report.messagesWithSwears}`);
  lines.push(`swearing messages: ${formatRate(report.messagesWithSwears, report.messagesScanned)}`);
  lines.push(`total swears:      ${report.totalSwears}`);
  lines.push("");
  lines.push("by source:");

  if (report.bySource.length === 0) {
    lines.push("  none");
  } else {
    for (const source of report.bySource) {
      lines.push(renderSourceLine(source, sourceWidth));
    }
  }

  lines.push("");
  lines.push("by agent:");

  if (report.byAgent.length === 0) {
    lines.push("  none");
  } else {
    for (const agent of report.byAgent) {
      lines.push(renderAgentLine(agent, agentWidth));
    }
  }

  lines.push("");
  lines.push("root words:");

  if (report.topWords.length === 0) {
    lines.push("  none");
  } else {
    for (const word of report.topWords) {
      lines.push(renderRootWordLine(word, wordWidth));
    }
  }

  lines.push("");
  lines.push("actual words:");

  if (report.actualWords.length === 0) {
    lines.push("  none");
  } else {
    for (const word of report.actualWords.slice(0, options.maxActualWords)) {
      lines.push(renderActualWordLine(word, actualWordWidth));
    }

    if (report.actualWords.length > options.maxActualWords) {
      lines.push(`  ... ${report.actualWords.length - options.maxActualWords} more; rerun with --max-actual-words ${report.actualWords.length}`);
    }
  }

  if (report.warnings.length > 0) {
    lines.push("");
    lines.push(`warnings: ${report.warnings.length} malformed records skipped`);
  }

  return `${lines.join("\n")}\n`;
}

function renderAgentLine(agent: AgentStats, agentWidth: number): string {
  return `  ${agent.agent.padEnd(agentWidth)}  ${String(agent.swears).padStart(5)} swears in ${String(agent.messages).padStart(5)} messages (${formatRate(agent.messagesWithSwears, agent.messages)} swearing)`;
}

function renderSourceLine(source: DevrageReport["bySource"][number], sourceWidth: number): string {
  return `  ${source.source.padEnd(sourceWidth)}  ${String(source.swears).padStart(5)} swears in ${String(source.messages).padStart(5)} messages across ${String(source.conversations).padStart(4)} conversations (${formatRate(source.messagesWithSwears, source.messages)} swearing)`;
}

function renderRootWordLine(word: WordStats, wordWidth: number): string {
  return `  ${word.root.padEnd(wordWidth)}  ${String(word.count).padStart(5)}`;
}

function renderActualWordLine(word: ActualWordStats, wordWidth: number): string {
  const suffix = word.word === word.root ? "" : ` (${word.root})`;
  return `  ${word.word.padEnd(wordWidth)}  ${String(word.count).padStart(5)}${suffix}`;
}

function renderMarkdownReport(report: DevrageReport, options: RenderOptions): string {
  const lines: string[] = [];

  lines.push("# Devrage Report");
  lines.push("");
  lines.push(`- Conversations scanned: ${report.conversationsScanned}`);
  lines.push(`- Messages scanned: ${report.messagesScanned}`);
  lines.push(`- Total swears: ${report.totalSwears}`);
  lines.push(`- Messages with swears: ${report.messagesWithSwears}`);
  lines.push(`- Swearing-message percent: ${formatRate(report.messagesWithSwears, report.messagesScanned)}`);
  lines.push("");
  lines.push("## By Source");
  lines.push("");
  lines.push("| Source | Conversations | Swears | Messages | Swearing messages |");
  lines.push("| --- | ---: | ---: | ---: | ---: |");

  for (const source of report.bySource) {
    lines.push(
      `| ${source.source} | ${source.conversations} | ${source.swears} | ${source.messages} | ${formatRate(source.messagesWithSwears, source.messages)} |`
    );
  }

  lines.push("");
  lines.push("## Daily");
  lines.push("");
  lines.push("| Date | Conversations | Swears | Messages | Swearing messages |");
  lines.push("| --- | ---: | ---: | ---: | ---: |");

  for (const day of report.daily) {
    lines.push(
      `| ${day.dateKey} | ${day.conversations} | ${day.swears} | ${day.messages} | ${formatRate(day.messagesWithSwears, day.messages)} |`
    );
  }
  lines.push("");
  lines.push("## By Agent");
  lines.push("");
  lines.push("| Agent | Swears | Messages | Swears per message |");
  lines.push("| --- | ---: | ---: | ---: |");

  for (const agent of report.byAgent) {
    lines.push(`| ${agent.agent} | ${agent.swears} | ${agent.messages} | ${formatRate(agent.messagesWithSwears, agent.messages)} |`);
  }

  lines.push("");
  lines.push("## Root Words");
  lines.push("");
  lines.push("| Root | Count |");
  lines.push("| --- | ---: |");

  for (const word of report.topWords) {
    lines.push(`| ${word.root} | ${word.count} |`);
  }

  lines.push("");
  lines.push("## Actual Words");
  lines.push("");
  lines.push("| Word or phrase | Root | Count |");
  lines.push("| --- | --- | ---: |");

  for (const word of report.actualWords.slice(0, options.maxActualWords)) {
    lines.push(`| ${word.word} | ${word.root} | ${word.count} |`);
  }

  if (report.actualWords.length > options.maxActualWords) {
    lines.push(`| ... ${report.actualWords.length - options.maxActualWords} more | | |`);
  }

  return `${lines.join("\n")}\n`;
}

const noColor = {
  bold: (value: string) => value,
  dim: (value: string) => value
};

function formatRate(swears: number, messages: number): string {
  if (messages === 0 || swears === 0) {
    return "0.0%";
  }

  const rate = (swears / messages) * 100;
  return rate < 0.1 ? "<0.1%" : `${rate.toFixed(1)}%`;
}
