# syntheticDataGenerator-ui

Vanilla HTML/CSS/JS frontend for the [syntheticDataGenerator](https://github.com/vokhotin/syntheticDataGenerator) Django API. Upload a DDL schema, generate synthetic table data with Gemini, preview and refine it, then apply it to a database — or chat with the AI about your schema.

## Features

- **Data Generation tab** — upload a `.sql` / `.txt` / `.ddl` schema file, set temperature and token limits, click Generate. Data streams in table by table via SSE. Each table has a per-row live preview and a modify prompt to re-generate with custom instructions (e.g. "use Russian names"). When satisfied, apply to the database with a configurable rows-per-table count.
- **Talk to Your Data tab** — LLM chat with your schema DDL and preview data loaded as context. Supports multi-turn conversation history.

## Prerequisites

- The Django backend running on `http://localhost:8000` (see [syntheticDataGenerator](https://github.com/vokhotin/syntheticDataGenerator))
- Any static file server (Python's built-in `http.server` works)

## Running locally

```bash
# 1. Start the backend (from the syntheticDataGenerator repo)
docker compose up

# 2. Serve the UI
cd syntheticDataGenerator-ui
python -m http.server 3000

# 3. Open http://localhost:3000
```

## Project structure

```
index.html       — app shell: sidebar, two tab sections, apply modal
style.css        — dark Catppuccin-inspired theme
js/
  state.js       — shared window.appState (fileId, generatedId, previewData)
  api.js         — fetch wrappers for all backend endpoints + SSE reader
  generate.js    — upload, generate stream, preview tables, modify, apply
  chat.js        — chat tab with streaming responses and conversation history
```

