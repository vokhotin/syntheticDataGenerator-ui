# syntheticDataGenerator UI — Design

**Date:** 2026-05-18
**Status:** Approved

---

## Overview

A vanilla HTML/CSS/JS frontend for the syntheticDataGenerator Django backend. Served as Django static files from the existing backend on `http://localhost:8000`. Two tabs: **Data Generation** and **Talk to Your Data**.

---

## Architecture

### Tech stack

- Vanilla HTML, CSS, JavaScript — no framework, no build step
- Served as Django static files from the existing backend
- No bundler, no transpilation — browser-native ES modules

### File structure

```
syntheticDataGenerator-ui/
├── index.html          # app shell: sidebar + tab switcher
├── style.css           # all styles
└── js/
    ├── state.js        # shared mutable state (fileId, generatedId, previewData)
    ├── api.js          # fetch wrappers for all backend endpoints
    ├── generate.js     # Data Generation tab logic
    └── chat.js         # Talk to Your Data tab logic
```

`index.html` links `style.css` and all four JS files in order (`state.js` first). Tab switching hides/shows the relevant content `<div>` via CSS class. `state.js` exposes a module-level `window.appState` object read by both `generate.js` and `chat.js`.

---

## Data Generation Tab

### Layout

1. **Upload Schema** — drag-and-drop zone + "Browse file" button. Accepted extensions: `.sql`, `.txt`, `.ddl`. Filename shown with a green checkmark after selection.
2. **Instructions** (optional) — textarea for a user prompt applied to generation.
3. **Parameters** — temperature slider (0–100, default 70) and optional max tokens input.
4. **Generate button** — disabled until a file is selected.
5. **Preview section** — appears after generation completes. One table card per DB table, each showing 3 preview rows. Each card has an inline prompt input + Submit button for modifications.
6. **Apply to Database button** — appears below all preview cards. Opens a modal asking for `rowsPerTable` (1–1000), then calls `/apply`.

### State (JS module-level variables in `generate.js`)

| Variable | Type | Set when |
|---|---|---|
| `fileId` | `string \| null` | `/upload` succeeds |
| `generatedId` | `string \| null` | `start` SSE event from `/generate` |
| `previewData` | `{[table]: Row[]}` | `row` SSE events from `/generate` or `/modify` |

### API flow

1. **Upload:** user selects file → `POST /upload` (multipart) → stores `fileId`. Error shown inline below drop zone on 400.
2. **Generate:** user clicks Generate → `GET /generate?fileId=…&temperature=…&maxTokens=…` → `EventSource` opened. As SSE events arrive:
   - `start` → stores `generatedId`, shows preview section skeleton
   - `row` → appends row to the correct table card in real time
   - `done` → enables Apply button; if the Instructions textarea was filled, immediately calls `/modify` with the instructions prompt
   - `error` → shows red banner above preview, re-enables Generate button
3. **Modify:** user types prompt in a table card and clicks Submit → `POST /modify` with `{generatedId, prompt}` → the backend regenerates preview rows for **all** tables using the prompt. The UI streams the updated rows and re-renders every table card. The prompt input is per-card for UX convenience but the modify call is global.
4. **Apply:** user clicks Apply → modal for `rowsPerTable` → `POST /apply` with `{generatedId, fileId, rowsPerTable}` → success toast on 200, error toast on failure.

### Instructions prompt handling

The current `/generate` endpoint does not accept a prompt parameter. If the user fills in the Instructions textarea, the UI calls `/modify` immediately after the `done` event, using the instructions text as the prompt. This means the first visible preview may briefly show un-prompted rows before the modify stream replaces them. A "Applying instructions…" spinner is shown during this step.

---

## Talk to Your Data Tab

### Layout

- **Context banner** (top): shows which schema file and tables are loaded. If no `generatedId` exists, shows a full-page empty state: *"Generate data first to enable chat."*
- **Message list**: scrollable, grows upward. User bubbles on the right, assistant bubbles on the left with a robot avatar.
- **Input bar** (bottom): auto-resizing textarea + Send button. Send disabled while a response is streaming.

### State (JS module-level in `chat.js`)

| Variable | Type | Description |
|---|---|---|
| `history` | `{role, content}[]` | Full conversation history, sent with each request |

`generatedId` is read from `window.appState.generatedId` (set by `generate.js`, shared via `state.js`).

### API flow

1. User types message and clicks Send (or presses Enter).
2. User bubble appended immediately.
3. `POST /chat` called with `{generatedId, message, history}`.
4. Response streamed via `fetch` + `ReadableStream`. `chunk` SSE events fill the assistant bubble character by character. `done` event re-enables Send and appends the completed assistant message to `history`.
5. On error: assistant bubble shows error text in red, Send re-enabled.

---

## New Backend Endpoint: POST /chat

**Path:** `POST /api/v1/generate-synthetic-data/chat`

**Request body:**
```json
{
  "generatedId": "<UUID>",
  "message": "What foreign key relationships exist?",
  "history": [
    {"role": "user", "content": "…"},
    {"role": "assistant", "content": "…"}
  ]
}
```

**Behaviour:**
1. Load `GeneratedDataSet` by `generatedId` (404 if not found).
2. Load associated `UploadedFile` (DDL text) and all `PreviewData` rows.
3. Build a system prompt containing the DDL and a JSON dump of preview rows grouped by table.
4. Reconstruct conversation history + new user message and call Gemini with streaming.
5. Stream response as `text/event-stream`:
   - `{"event": "chunk", "text": "…"}` — one per streamed token
   - `{"event": "done"}` — stream complete
   - `{"event": "error", "message": "…"}` — on failure

**Validation (new `ChatSerializer`):**
- `generatedId`: UUID, required
- `message`: non-empty string, required
- `history`: list of `{role: "user"|"assistant", content: str}`, optional (default `[]`)

**Temperature and max_tokens** are read from the `GeneratedDataSet` record, consistent with other endpoints.

---

## Error Handling Summary

| Scenario | UI response |
|---|---|
| Upload: bad extension or empty file | Inline error below drop zone |
| Generate: SSE `error` event | Red banner above preview, Generate re-enabled |
| Modify: SSE `error` event | Inline error below the table card's prompt input |
| Apply: non-200 response | Error toast, modal stays open |
| Chat: SSE `error` event | Error text in assistant bubble, Send re-enabled |
| Chat tab opened with no `generatedId` | Full-page empty state with instructions |

---

## Integration with Django Backend

The UI files live in the `syntheticDataGenerator-ui` repo and are copied into the Django backend's `STATICFILES_DIRS` (or served directly from `STATIC_ROOT` after `collectstatic`). The backend already runs on port 8000; no separate dev server is needed.

For local development, the simplest approach is to symlink or copy the UI directory into the Django project, or configure `STATICFILES_DIRS` to point at the UI repo path.

---

## Out of Scope

- Authentication / multi-tenancy
- Download generated data as CSV/JSON
- Multiple concurrent generation sessions
- Persisting chat history across page reloads
