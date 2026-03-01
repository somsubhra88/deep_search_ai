# Deep Search Executor

Local executor for the Deep Search AI Assistant. Runs on `127.0.0.1:7777` and provides 16 tools with policy enforcement, workspace sandbox, approval flows, undo/rollback, and scheduled tasks.

## Tools

| Tool | Risk | Description |
|------|------|-------------|
| fs.list | R0 | List directory contents |
| fs.read | R0 | Read file content |
| fs.stat | R0 | Get file/dir metadata |
| notes.search | R0 | Search notes by title/content |
| clipboard.read | R0 | Read system clipboard |
| clipboard.write | R0 | Write to system clipboard |
| fs.append | R1 | Append to file |
| fs.copy | R1 | Copy file or directory |
| fs.move | R1 | Move file or directory |
| fs.rename | R1 | Rename file or directory |
| notes.create | R1 | Create note in app data |
| notes.update | R1 | Update note |
| fs.write | R2 | Write file (overwrite) |
| fs.delete | R2 | Trash file or directory (undoable) |
| archive.extract | R2 | Extract archive |
| net.download | R3 | Download URL to path |
| shell.run | R3 | Run shell command |

## Endpoints

- `POST /v1/tool/execute` – Execute tool(s). Supports `tool`, `tools` (chain), `dry_run`, `context`
- `POST /v1/approval/respond` – Respond to pending approval (approve/deny, optional save_rule)
- `GET /v1/runs/{run_id}/events` – SSE stream of run events
- `GET /v1/rules` – List rules
- `POST /v1/rules` – Create rule
- `DELETE /v1/rules/{id}` – Delete rule
- `POST /v1/history/clear` – Clear audit logs
- `POST /v1/undo` – Undo last action (restore via shell in background)
- `GET /v1/undo/list` – List available undo entries
- `GET /v1/schedule`, `POST /v1/schedule`, `DELETE /v1/schedule/{id}` – Scheduled tasks

## Build & Run

```bash
cargo build --release
cargo run
```

## Config

- **Data dir**: `%APPDATA%/DeepSearchAI/` (Windows), `~/Library/Application Support/DeepSearchAI/` (macOS), `~/.local/share/deepsearchai/` (Linux)
- **Database**: `rules.db` in data dir
- **Logs**: `logs/*.jsonl` per run_id (secrets redacted)

## Features

- **Trash instead of delete** – `fs.delete` moves to system trash (macOS/Linux/Windows)
- **Clipboard** – `clipboard.read` / `clipboard.write` (pbcopy/pbpaste, xclip, wl-copy)
- **Notes search** – `notes.search` with query and optional folder
- **Dry-run** – `{"dry_run": true, "tool": {...}}` returns planned action without executing
- **Tool chaining** – `{"tools": [{...}, {...}]}` runs multiple tools sequentially
- **Context from search** – `{"context": {"query": "...", "results": [...]}}` passed to audit
- **Undo/rollback** – fs.write, fs.delete, fs.move create backups; `POST /v1/undo` restores via shell in background
- **Scheduled tasks** – `POST /v1/schedule` with `tool`, `run_at` (RFC3339), optional `cron`; polled every 30s

## Example

```bash
# List directory
curl -X POST http://127.0.0.1:7777/v1/tool/execute \
  -H "Content-Type: application/json" \
  -d '{"tool":{"tool":"fs_list","path":"."}}'

# Dry-run
curl -X POST http://127.0.0.1:7777/v1/tool/execute \
  -H "Content-Type: application/json" \
  -d '{"dry_run":true,"tool":{"tool":"fs_write","path":"/tmp/foo.txt","content":"hi"}}'

# Tool chain
curl -X POST http://127.0.0.1:7777/v1/tool/execute \
  -H "Content-Type: application/json" \
  -d '{"tools":[{"tool":"fs_list","path":"."},{"tool":"notes_search","query":"meeting"}]}'

# Undo last action
curl -X POST http://127.0.0.1:7777/v1/undo -H "Content-Type: application/json" -d '{}'
```
