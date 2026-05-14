# forge-devrage

Local-first profanity and frustration metrics for AI-agent conversation logs.

`forge-devrage` scans local agent archives, counts user-message swear/frustration
terms, and returns structured conversation/day summaries. It does not upload logs
or print raw message content.

## Quick Start

```bash
npx forge-devrage
```

For local development:

```bash
npm install
npm run report
```

By default, `forge-devrage` scans supported local sources and counts `user`
messages only. Assistant/developer/system roles are opt-in.

## Common Commands

```bash
# Today's conversations, bucketed by local updated date
npx forge-devrage --date 2026-05-14

# Only Codex and Claude
npx forge-devrage --sources codex,claude

# Include assistant messages explicitly
npx forge-devrage --roles user,assistant

# JSON for dashboards or Forge ingestion
npx forge-devrage --format json --out devrage-history.json

# ISO range over conversation updated_at timestamps
npx forge-devrage --since 2026-05-01T00:00:00Z --until 2026-05-15T00:00:00Z
```

## Supported Sources

- Codex: `~/.codex/sessions` and `~/.codex/archived_sessions`
- Claude: `~/.claude/projects`
- OpenCode: local `opencode.db` when `better-sqlite3` can be loaded
- Amp: local thread JSON files
- Cline/Roo: VS Code/Cursor global storage task history
- Zed: local conversation JSON files
- OpenClaw and Hermes: safely discovered local JSON/JSONL conversation-like logs

## Structured Output

JSON output includes:

- `conversations`: one row per source/conversation with `updatedAt`, `dateKey`,
  `messages`, `messagesWithSwears`, and `swears`
- `daily`: date-bucketed aggregates
- `bySource` and `byAgent` summaries
- root-word and actual-word counts

The percentage used by Forge is:

```text
messagesWithSwears / messagesScanned * 100
```

## Privacy

The scanner reads local files only. Reports include counts and metadata, not raw
conversation text. Do not commit generated report files from personal logs.
