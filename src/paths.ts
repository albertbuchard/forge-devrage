import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import fg from "fast-glob";

export interface ResolveInputOptions {
  codexHome: string;
}

export async function resolveInputFiles(inputs: string[], options: ResolveInputOptions): Promise<string[]> {
  const patterns = inputs.length > 0 ? inputs.map(expandHome) : defaultCodexPatterns(options.codexHome);
  const expandedPatterns = patterns.flatMap((input) => expandInputToPatterns(input));
  const files = await fg(expandedPatterns, {
    absolute: true,
    onlyFiles: true,
    unique: true,
    dot: true,
    caseSensitiveMatch: false
  });

  return files.filter((file) => file.toLowerCase().endsWith(".jsonl")).sort();
}

function defaultCodexPatterns(codexHome: string): string[] {
  const root = expandHome(codexHome);
  return [`${root}/archived_sessions/**/*.jsonl`, `${root}/sessions/**/*.jsonl`];
}

function expandInputToPatterns(input: string): string[] {
  const absoluteInput = isAbsolute(input) ? input : resolve(process.cwd(), input);

  if (!hasGlobMagic(input) && existsSync(absoluteInput)) {
    const stat = statSync(absoluteInput);

    if (stat.isDirectory()) {
      return [`${absoluteInput.replace(/\/+$/, "")}/**/*.jsonl`];
    }

    return [absoluteInput];
  }

  return [input];
}

function expandHome(input: string): string {
  if (input === "~") {
    return homedir();
  }

  if (input.startsWith("~/")) {
    return `${homedir()}${input.slice(1)}`;
  }

  return input;
}

function hasGlobMagic(input: string): boolean {
  return /[*?[\]{}()!+@]/.test(input);
}
