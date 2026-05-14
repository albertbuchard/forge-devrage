#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { Command, InvalidArgumentError } from "commander";
import { availableSources, scanConversations } from "./scan.js";
import { renderReport, type ReportFormat } from "./report.js";
import type { DevrageSource, MessageRole } from "./types.js";

process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") {
    process.exit(0);
  }
  throw error;
});

const allowedRoles = new Set<MessageRole>(["assistant", "user", "developer", "system", "unknown"]);
const allowedFormats = new Set<ReportFormat>(["text", "json", "markdown"]);
const allowedSources = new Set<DevrageSource>(availableSources());

const program = new Command()
  .name("forge-devrage")
  .alias("devrage")
  .description("Analyze local AI-agent conversation logs for profanity and frustration metrics.")
  .option("--sources <sources>", "Comma-separated sources to scan. Defaults to all supported local sources.", parseSources)
  .option("--roles <roles>", "Comma-separated roles to scan.", parseRoles, new Set<MessageRole>(["user"]))
  .option("--date <yyyy-mm-dd>", "Only include conversations updated on this local date.", parseDateKey)
  .option("--since <date>", "Only include conversations updated at or after this ISO date/time.", parseDate)
  .option("--until <date>", "Only include conversations updated before this ISO date/time.", parseDate)
  .option("--time-zone <zone>", "IANA time zone for --date bucketing.", Intl.DateTimeFormat().resolvedOptions().timeZone)
  .option("--format <format>", "Output format: text, markdown, or json.", parseFormat, "text")
  .option("--out <file>", "Write the rendered report to a file instead of stdout.")
  .option("--color", "Force colored terminal output.")
  .option("--no-color", "Disable colored terminal output.")
  .option("--max-actual-words <count>", "Maximum actual words or phrases to show.", parsePositiveInteger)
  .option("--max-variants <count>", "Deprecated alias for --max-actual-words.", parsePositiveInteger)
  .action(async (options: CliOptions) => {
    const report = await scanConversations({
      roles: options.roles,
      sources: options.sources,
      date: options.date,
      since: options.since,
      until: options.until,
      timeZone: options.timeZone
    });
    const rendered = renderReport(report, options.format, {
      color: options.color ?? process.stdout.isTTY,
      maxActualWords: options.maxActualWords ?? options.maxVariants ?? Number.MAX_SAFE_INTEGER
    });

    if (options.out) {
      await writeFile(options.out, rendered, "utf8");
      return;
    }

    process.stdout.write(rendered);
  });

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`forge-devrage: ${message}\n`);
  process.exitCode = 1;
});

interface CliOptions {
  sources?: Set<DevrageSource>;
  roles: Set<MessageRole>;
  date?: string;
  since?: Date;
  until?: Date;
  timeZone: string;
  format: ReportFormat;
  out?: string;
  color?: boolean;
  maxActualWords?: number;
  maxVariants?: number;
}

function parseSources(value: string): Set<DevrageSource> {
  const sources = value
    .split(",")
    .map((source) => source.trim().toLowerCase())
    .filter(Boolean);

  if (sources.length === 0) {
    throw new InvalidArgumentError("At least one source is required.");
  }

  for (const source of sources) {
    if (!allowedSources.has(source as DevrageSource)) {
      throw new InvalidArgumentError(`Unsupported source "${source}". Use ${availableSources().join(", ")}.`);
    }
  }

  return new Set(sources as DevrageSource[]);
}

function parseRoles(value: string): Set<MessageRole> {
  const roles = value
    .split(",")
    .map((role) => role.trim().toLowerCase())
    .filter(Boolean);

  if (roles.length === 0) {
    throw new InvalidArgumentError("At least one role is required.");
  }

  for (const role of roles) {
    if (!allowedRoles.has(role as MessageRole)) {
      throw new InvalidArgumentError(`Unsupported role "${role}". Use assistant, user, developer, system, or unknown.`);
    }
  }

  return new Set(roles as MessageRole[]);
}

function parseFormat(value: string): ReportFormat {
  const format = value.toLowerCase();

  if (!allowedFormats.has(format as ReportFormat)) {
    throw new InvalidArgumentError("Unsupported format. Use text, markdown, or json.");
  }

  return format as ReportFormat;
}

function parseDateKey(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new InvalidArgumentError("Expected date as YYYY-MM-DD.");
  }
  return value;
}

function parseDate(value: string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new InvalidArgumentError("Expected a valid ISO date/time.");
  }
  return parsed;
}

function parsePositiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError("Expected a positive integer.");
  }

  return parsed;
}
