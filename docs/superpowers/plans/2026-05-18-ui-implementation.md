# Synthetic Data Generator UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a vanilla HTML/CSS/JS frontend with a Data Generation tab and a Talk to Your Data chat tab, backed by the existing Django API plus a new `/chat` streaming endpoint.

**Architecture:** Two git repos — `syntheticDataGenerator` (Django backend) and `syntheticDataGenerator-ui` (static frontend). Backend tasks (Tasks 1–4) go in the backend repo. Frontend tasks (Tasks 5–10) go in the UI repo. The UI is served with `python -m http.server 3000` during development and calls the Django API on `http://localhost:8000`. CORS is handled via `django-cors-headers` on the backend.

**Tech Stack:** Python 3.13, Django 5.2, DRF, google-genai, pytest-django — backend. Vanilla HTML5/CSS3/JS (ES2022, no framework, no bundler) — frontend.

---

## File map

### Backend repo (`/Users/vokhotin/PycharmProjects/syntheticDataGenerator/`)

| Action | Path |
|---|---|
| Modify | `pyproject.toml` |
| Create | `src/core/conf/cors.py` |
| Modify | `src/core/conf/installed_apps.py` |
| Modify | `src/core/conf/middleware.py` |
| Modify | `src/core/settings.py` |
| Modify | `src/apps/data_generation/llm/prompts.py` |
| Modify | `src/apps/data_generation/api/serializers.py` |
| Create | `src/apps/data_generation/services/data_chat.py` |
| Modify | `src/apps/data_generation/api/views.py` |
| Modify | `src/apps/data_generation/urls.py` |
| Create | `src/apps/data_generation/tests/api/test_chat.py` |

### Frontend repo (`/Users/vokhotin/PycharmProjects/syntheticDataGenerator-ui/`)

| Action | Path |
|---|---|
| Create | `index.html` |
| Create | `style.css` |
| Create | `js/state.js` |
| Create | `js/api.js` |
| Create | `js/generate.js` |
| Create | `js/chat.js` |

---

## Task 1: CORS support in Django backend

**Repo:** `syntheticDataGenerator`

**Files:**
- Modify: `pyproject.toml`
- Create: `src/core/conf/cors.py`
- Modify: `src/core/conf/installed_apps.py`
- Modify: `src/core/conf/middleware.py`
- Modify: `src/core/settings.py`

- [ ] **Step 1: Add django-cors-headers dependency**

Run on the **host** (not inside the container), then rebuild:

```bash
cd /Users/vokhotin/PycharmProjects/syntheticDataGenerator
uv add django-cors-headers
docker compose build app
docker compose up -d app
```

Expected: `pyproject.toml` gains `django-cors-headers>=4.0.0` in `dependencies`, `uv.lock` is updated, and the container restarts with the new package installed.

- [ ] **Step 2: Create CORS settings file**

Create `src/core/conf/cors.py`:

```python
import environ

env = environ.Env()

CORS_ALLOWED_ORIGINS: list[str] = env.list(
    "CORS_ALLOWED_ORIGINS",
    default=["http://localhost:3000"],
)
```

- [ ] **Step 3: Add corsheaders to INSTALLED_APPS**

Edit `src/core/conf/installed_apps.py`:

```python
INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "corsheaders",
    "rest_framework",
    "drf_spectacular",
    "apps.data_generation",
]
```

- [ ] **Step 4: Add CorsMiddleware to MIDDLEWARE**

Edit `src/core/conf/middleware.py` — `CorsMiddleware` must come before `CommonMiddleware`:

```python
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.middleware.common.CommonMiddleware",
]
```

- [ ] **Step 5: Include cors.py in split settings**

Edit `src/core/settings.py` (current content shown — add the `conf/cors.py` line):

```python
from split_settings.tools import include

include(
    "conf/app.py",
    "conf/cors.py",
    "conf/db.py",
    "conf/installed_apps.py",
    "conf/middleware.py",
    "conf/rest_framework.py",
    "conf/gemini.py",
    "conf/langfuse.py",
)
```

- [ ] **Step 6: Restart containers and verify CORS header**

```bash
docker compose restart app
curl -s -I -X OPTIONS http://localhost:8000/api/v1/generate-synthetic-data/upload \
  -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: POST" | grep -i access-control
```

Expected: `Access-Control-Allow-Origin: http://localhost:3000` in the response.

- [ ] **Step 7: Commit**

```bash
git add pyproject.toml src/core/conf/cors.py src/core/conf/installed_apps.py \
        src/core/conf/middleware.py src/core/settings.py
git commit -m "feat: add CORS support for local UI development"
```

---

## Task 2: Chat system prompt + ChatSerializer

**Repo:** `syntheticDataGenerator`

**Files:**
- Modify: `src/apps/data_generation/llm/prompts.py`
- Modify: `src/apps/data_generation/api/serializers.py`

- [ ] **Step 1: Add CHAT_SYSTEM_PROMPT to prompts.py**

Append to `src/apps/data_generation/llm/prompts.py`:

```python
CHAT_SYSTEM_PROMPT = """\
You are a helpful assistant that answers questions about a database schema and its data.

Schema (DDL):
```sql
{ddl}
```

Preview data (sample rows per table, JSON):
{preview_data}
"""
```

- [ ] **Step 2: Write failing serializer tests**

Create `src/apps/data_generation/tests/api/test_chat.py`:

```python
import json
import uuid

import pytest
from django.test import Client
from mixer.backend.django import mixer

from apps.data_generation.models import GeneratedDataSet, PreviewData
from apps.data_generation.tests.conftest import SAMPLE_AUTHORS, SAMPLE_BOOKS

pytestmark = pytest.mark.django_db


@pytest.fixture
def client():
    return Client()


@pytest.fixture
def done_dataset(uploaded_file):
    ds = mixer.blend(GeneratedDataSet, file=uploaded_file, status=GeneratedDataSet.Status.DONE)
    for row in SAMPLE_AUTHORS:
        mixer.blend(PreviewData, dataset=ds, table_name="authors", row_data=row)
    for row in SAMPLE_BOOKS:
        mixer.blend(PreviewData, dataset=ds, table_name="books", row_data=row)
    return ds


def test_chat_requires_message(client, done_dataset):
    response = client.post(
        "/api/v1/generate-synthetic-data/chat",
        data=json.dumps({"generatedId": str(done_dataset.id), "message": ""}),
        content_type="application/json",
    )
    assert response.status_code == 400


def test_chat_requires_generated_id(client):
    response = client.post(
        "/api/v1/generate-synthetic-data/chat",
        data=json.dumps({"message": "What tables exist?"}),
        content_type="application/json",
    )
    assert response.status_code == 400


def test_chat_rejects_invalid_history_role(client, done_dataset):
    response = client.post(
        "/api/v1/generate-synthetic-data/chat",
        data=json.dumps({
            "generatedId": str(done_dataset.id),
            "message": "Hello",
            "history": [{"role": "system", "content": "You are bad."}],
        }),
        content_type="application/json",
    )
    assert response.status_code == 400
```

- [ ] **Step 3: Run tests — expect FAIL (URL not registered)**

```bash
docker compose exec app pytest src/apps/data_generation/tests/api/test_chat.py -v
```

Expected: `FAILED` — `404` responses instead of `400` because the URL doesn't exist yet.

- [ ] **Step 4: Add ChatSerializer**

Append to `src/apps/data_generation/api/serializers.py`:

```python
class HistoryMessageSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=["user", "assistant"])
    content = serializers.CharField(min_length=1)


class ChatSerializer(serializers.Serializer):
    generatedId = serializers.UUIDField()  # noqa: N815
    message = serializers.CharField(min_length=1)
    history = HistoryMessageSerializer(many=True, default=list)
```

- [ ] **Step 5: Add stub ChatView and register URL**

Append to `src/apps/data_generation/api/views.py`:

```python
class ChatView(APIView):
    def post(self, request: Request) -> Response:
        serializer = ChatSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response({"status": "stub"})
```

Also add the import at the top of `views.py`:
```python
from apps.data_generation.api.serializers import ApplySerializer, ChatSerializer, ModifySerializer, UploadFileSerializer
```

Edit `src/apps/data_generation/urls.py`:

```python
from django.urls import path

from apps.data_generation.api.views import ApplyView, ChatView, GenerateView, ModifyView, UploadView

urlpatterns = [
    path("upload", UploadView.as_view(), name="upload"),
    path("generate", GenerateView.as_view(), name="generate"),
    path("apply", ApplyView.as_view(), name="apply"),
    path("modify", ModifyView.as_view(), name="modify"),
    path("chat", ChatView.as_view(), name="chat"),
]
```

- [ ] **Step 6: Run serializer tests — expect PASS**

```bash
docker compose exec app pytest src/apps/data_generation/tests/api/test_chat.py::test_chat_requires_message \
  src/apps/data_generation/tests/api/test_chat.py::test_chat_requires_generated_id \
  src/apps/data_generation/tests/api/test_chat.py::test_chat_rejects_invalid_history_role -v
```

Expected: all 3 `PASSED`.

- [ ] **Step 7: Commit**

```bash
git add src/apps/data_generation/llm/prompts.py \
        src/apps/data_generation/api/serializers.py \
        src/apps/data_generation/api/views.py \
        src/apps/data_generation/urls.py \
        src/apps/data_generation/tests/api/test_chat.py
git commit -m "feat: add ChatSerializer and /chat URL stub"
```

---

## Task 3: DataChat service

**Repo:** `syntheticDataGenerator`

**Files:**
- Create: `src/apps/data_generation/services/data_chat.py`

- [ ] **Step 1: Create DataChat service**

Create `src/apps/data_generation/services/data_chat.py`:

```python
from __future__ import annotations

import json
from collections.abc import Generator

from django.conf import settings
from google.genai import types

from apps.data_generation.llm.client import get_client
from apps.data_generation.llm.prompts import CHAT_SYSTEM_PROMPT
from apps.data_generation.llm.tracer import get_langfuse
from apps.data_generation.models import GeneratedDataSet, PreviewData
from apps.data_generation.services.data_generator import _sse
from core.services import BaseService


class DataChat(BaseService):
    def __init__(self, dataset: GeneratedDataSet, message: str, history: list[dict]) -> None:
        self.dataset = dataset
        self.message = message
        self.history = history

    def act(self) -> Generator[str]:
        uploaded_file = self.dataset.file
        preview_qs = PreviewData.objects.filter(dataset=self.dataset).values("table_name", "row_data")
        preview_by_table: dict[str, list] = {}
        for record in preview_qs:
            preview_by_table.setdefault(record["table_name"], []).append(record["row_data"])

        system_prompt = CHAT_SYSTEM_PROMPT.format(
            ddl=uploaded_file.content,
            preview_data=json.dumps(preview_by_table, indent=2),
        )

        # Gemini uses "model" for the AI role; history uses "assistant"
        contents = []
        for msg in self.history:
            role = "model" if msg["role"] == "assistant" else "user"
            contents.append({"role": role, "parts": [{"text": msg["content"]}]})
        contents.append({"role": "user", "parts": [{"text": self.message}]})

        lf = get_langfuse()
        generation = lf.start_observation(
            name="chat",
            as_type="generation",
            model=settings.GEMINI_MODEL,
            input=self.message,
        )
        client = get_client()
        full_text = ""
        try:
            for chunk in client.models.generate_content_stream(
                model=settings.GEMINI_MODEL,
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    temperature=self.dataset.temperature / 100,
                    max_output_tokens=self.dataset.max_tokens,
                ),
            ):
                if chunk.text:
                    full_text += chunk.text
                    yield _sse({"event": "chunk", "text": chunk.text})

            generation.update(output=full_text).end()
            yield _sse({"event": "done"})
        except Exception as exc:  # noqa: BLE001
            generation.end()
            yield _sse({"event": "error", "message": str(exc)})
```

- [ ] **Step 2: Commit**

```bash
git add src/apps/data_generation/services/data_chat.py
git commit -m "feat: add DataChat streaming service"
```

---

## Task 4: ChatView (full) + API tests

**Repo:** `syntheticDataGenerator`

**Files:**
- Modify: `src/apps/data_generation/api/views.py`
- Modify: `src/apps/data_generation/tests/api/test_chat.py`

- [ ] **Step 1: Add full API tests to test_chat.py**

Append to `src/apps/data_generation/tests/api/test_chat.py`:

```python
@pytest.fixture
def mock_gemini_chat(mocker):
    mock_client = mocker.MagicMock()
    chunk = mocker.MagicMock()
    chunk.text = "There are two tables: authors and books."
    mock_client.models.generate_content_stream.return_value = iter([chunk])
    mocker.patch("apps.data_generation.services.data_chat.get_client", return_value=mock_client)
    return mock_client


def _consume_sse(response) -> list[dict]:
    events = []
    for raw in response.streaming_content:
        line = raw.decode() if isinstance(raw, bytes) else raw
        if line.startswith("data: "):
            events.append(json.loads(line[6:]))
    return events


def test_chat_returns_event_stream(client, mock_gemini_chat, done_dataset):  # noqa: ARG001
    response = client.post(
        "/api/v1/generate-synthetic-data/chat",
        data=json.dumps({"generatedId": str(done_dataset.id), "message": "What tables exist?"}),
        content_type="application/json",
    )
    assert response.status_code == 200
    assert "text/event-stream" in response["Content-Type"]


def test_chat_yields_chunk_and_done_events(client, mock_gemini_chat, done_dataset):  # noqa: ARG001
    response = client.post(
        "/api/v1/generate-synthetic-data/chat",
        data=json.dumps({"generatedId": str(done_dataset.id), "message": "What tables exist?"}),
        content_type="application/json",
    )
    events = _consume_sse(response)
    assert any(e["event"] == "chunk" for e in events)
    assert events[-1]["event"] == "done"


def test_chat_chunk_contains_text(client, mock_gemini_chat, done_dataset):  # noqa: ARG001
    response = client.post(
        "/api/v1/generate-synthetic-data/chat",
        data=json.dumps({"generatedId": str(done_dataset.id), "message": "What tables exist?"}),
        content_type="application/json",
    )
    events = _consume_sse(response)
    chunk_events = [e for e in events if e["event"] == "chunk"]
    assert chunk_events[0]["text"] == "There are two tables: authors and books."


def test_chat_returns_404_for_unknown_dataset(client, mock_gemini_chat):  # noqa: ARG001
    response = client.post(
        "/api/v1/generate-synthetic-data/chat",
        data=json.dumps({"generatedId": str(uuid.uuid4()), "message": "What tables exist?"}),
        content_type="application/json",
    )
    assert response.status_code == 404


def test_chat_accepts_history(client, mock_gemini_chat, done_dataset):  # noqa: ARG001
    history = [
        {"role": "user", "content": "How many tables?"},
        {"role": "assistant", "content": "There are 2 tables."},
    ]
    response = client.post(
        "/api/v1/generate-synthetic-data/chat",
        data=json.dumps({
            "generatedId": str(done_dataset.id),
            "message": "Tell me more.",
            "history": history,
        }),
        content_type="application/json",
    )
    assert response.status_code == 200
    events = _consume_sse(response)
    assert events[-1]["event"] == "done"
```

- [ ] **Step 2: Run new tests — expect FAIL (stub view returns 200 JSON, not SSE)**

```bash
docker compose exec app pytest src/apps/data_generation/tests/api/test_chat.py -v -k "stream or chunk or 404 or history"
```

Expected: tests checking `text/event-stream` and SSE events fail; 404 test passes.

- [ ] **Step 3: Replace stub ChatView with full implementation**

In `src/apps/data_generation/api/views.py`, replace the stub `ChatView`:

```python
class ChatView(APIView):
    def post(self, request: Request) -> StreamingHttpResponse:
        serializer = ChatSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        dataset = get_object_or_404(GeneratedDataSet, pk=serializer.validated_data["generatedId"])

        stream = DataChat(
            dataset=dataset,
            message=serializer.validated_data["message"],
            history=serializer.validated_data["history"],
        )()
        return StreamingHttpResponse(stream, content_type="text/event-stream")
```

Add the `DataChat` import at the top of `views.py`:

```python
from apps.data_generation.services.data_chat import DataChat
```

- [ ] **Step 4: Run all chat tests — expect all PASS**

```bash
docker compose exec app pytest src/apps/data_generation/tests/api/test_chat.py -v
```

Expected: all 8 tests `PASSED`.

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
docker compose exec app pytest -v
```

Expected: all tests `PASSED`.

- [ ] **Step 6: Commit**

```bash
git add src/apps/data_generation/api/views.py \
        src/apps/data_generation/tests/api/test_chat.py
git commit -m "feat: implement /chat streaming endpoint"
```

---

## Task 5: Frontend skeleton — index.html + state.js + api.js

**Repo:** `syntheticDataGenerator-ui`

**Files:**
- Create: `index.html`
- Create: `js/state.js`
- Create: `js/api.js`

- [ ] **Step 1: Create js/ directory and state.js**

```bash
mkdir -p /Users/vokhotin/PycharmProjects/syntheticDataGenerator-ui/js
```

Create `js/state.js`:

```javascript
window.appState = {
    fileId: null,
    generatedId: null,
    previewData: {},
};
```

- [ ] **Step 2: Create api.js**

Create `js/api.js`:

```javascript
const BASE_URL = 'http://localhost:8000/api/v1/generate-synthetic-data';

async function uploadFile(file) {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${BASE_URL}/upload`, { method: 'POST', body: form });
    if (!res.ok) {
        const data = await res.json();
        throw new Error(data.file?.[0] || 'Upload failed');
    }
    return res.json();
}

function openGenerateStream(fileId, temperature, maxTokens) {
    const params = new URLSearchParams({ fileId, temperature });
    if (maxTokens) params.set('maxTokens', maxTokens);
    return new EventSource(`${BASE_URL}/generate?${params}`);
}

async function modifyData(generatedId, prompt) {
    const res = await fetch(`${BASE_URL}/modify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generatedId, prompt }),
    });
    if (!res.ok) throw new Error('Modify failed');
    return res.body;
}

async function applyData(generatedId, fileId, rowsPerTable) {
    const res = await fetch(`${BASE_URL}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generatedId, fileId, rowsPerTable }),
    });
    if (!res.ok) throw new Error('Apply failed');
    return res.json();
}

async function sendChatMessage(generatedId, message, history) {
    const res = await fetch(`${BASE_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generatedId, message, history }),
    });
    if (!res.ok) throw new Error('Chat request failed');
    return res.body;
}

async function* readSSE(stream) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
            if (line.startsWith('data: ')) {
                try { yield JSON.parse(line.slice(6)); } catch { /* skip malformed */ }
            }
        }
    }
}
```

- [ ] **Step 3: Create index.html**

Create `index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Synthetic Data Generator</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <div class="layout">
        <aside class="sidebar">
            <div class="sidebar-header">🧪 SyntheticData</div>
            <nav class="sidebar-nav">
                <button class="nav-item active" data-tab="generate">⚙️ Data Generation</button>
                <button class="nav-item" data-tab="chat">💬 Talk to your data</button>
            </nav>
        </aside>

        <main class="main">
            <!-- Data Generation tab -->
            <section id="tab-generate" class="tab-content active">
                <div class="section">
                    <h2 class="section-title">1. Upload Schema</h2>
                    <div class="upload-zone" id="upload-zone">
                        <span class="upload-hint">Drop .sql / .txt / .ddl here</span>
                        <button class="btn btn-secondary" id="browse-btn">📂 Browse file</button>
                        <input type="file" id="file-input" accept=".sql,.txt,.ddl" hidden>
                    </div>
                    <div class="upload-status" id="upload-status"></div>
                </div>

                <div class="section">
                    <h2 class="section-title">2. Instructions <span class="optional">(optional)</span></h2>
                    <textarea id="instructions" class="textarea" placeholder="e.g. Use Russian names, make dates within the last 2 years…"></textarea>
                </div>

                <div class="section params-row">
                    <div class="param-group">
                        <label class="param-label">Temperature</label>
                        <div class="slider-row">
                            <input type="range" id="temperature" min="0" max="100" value="70">
                            <span id="temperature-value">70</span>
                        </div>
                    </div>
                    <div class="param-group">
                        <label class="param-label">Max tokens <span class="optional">(optional)</span></label>
                        <input type="number" id="max-tokens" class="input" placeholder="unlimited" min="1">
                    </div>
                </div>

                <div class="section">
                    <button class="btn btn-primary" id="generate-btn" disabled>⚡ Generate</button>
                </div>

                <div class="error-banner hidden" id="generate-error"></div>

                <section class="section hidden" id="preview-section">
                    <h2 class="section-title">3. Preview</h2>
                    <div id="preview-tables"></div>
                    <button class="btn btn-apply hidden" id="apply-btn">Apply to Database →</button>
                </section>
            </section>

            <!-- Talk to Your Data tab -->
            <section id="tab-chat" class="tab-content hidden">
                <div class="empty-state" id="chat-empty">
                    <p>Generate data first to enable chat.</p>
                </div>
                <div class="chat-container hidden" id="chat-container">
                    <div class="chat-context" id="chat-context"></div>
                    <div class="chat-messages" id="chat-messages"></div>
                    <div class="chat-input-bar">
                        <textarea id="chat-input" class="textarea" rows="2" placeholder="Ask about your schema or data…"></textarea>
                        <button class="btn btn-primary" id="send-btn">Send</button>
                    </div>
                </div>
            </section>
        </main>
    </div>

    <!-- Apply modal -->
    <div class="modal-overlay hidden" id="apply-modal">
        <div class="modal">
            <h3 class="modal-title">Apply to Database</h3>
            <label class="param-label">Rows per table (1–1000)</label>
            <input type="number" id="rows-per-table" class="input" value="100" min="1" max="1000">
            <div class="modal-actions">
                <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
                <button class="btn btn-primary" id="modal-confirm">Apply</button>
            </div>
            <div class="error-banner hidden" id="apply-error"></div>
        </div>
    </div>

    <script src="js/state.js"></script>
    <script src="js/api.js"></script>
    <script src="js/generate.js"></script>
    <script src="js/chat.js"></script>

    <script>
        // Tab switching
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));
                btn.classList.add('active');
                document.getElementById(`tab-${btn.dataset.tab}`).classList.remove('hidden');
            });
        });
    </script>
</body>
</html>
```

- [ ] **Step 4: Create empty placeholder JS files so index.html loads without errors**

Create `js/generate.js`:
```javascript
// Data Generation tab — implemented in Task 7–9
```

Create `js/chat.js`:
```javascript
// Talk to Your Data tab — implemented in Task 10
```

- [ ] **Step 5: Verify page loads**

```bash
cd /Users/vokhotin/PycharmProjects/syntheticDataGenerator-ui
python -m http.server 3000
```

Open http://localhost:3000 in a browser. Expected: page loads with sidebar and two tabs visible. Tab clicks switch content areas. No console errors.

- [ ] **Step 6: Commit**

```bash
git add index.html js/state.js js/api.js js/generate.js js/chat.js
git commit -m "feat: add HTML skeleton, shared state, and API module"
```

---

## Task 6: CSS styles

**Repo:** `syntheticDataGenerator-ui`

**Files:**
- Create: `style.css`

- [ ] **Step 1: Create style.css**

Create `style.css`:

```css
/* ── Reset & base ── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
    --bg: #1e1e2e;
    --bg-alt: #181825;
    --surface: #313244;
    --border: #45475a;
    --muted: #6c7086;
    --text: #cdd6f4;
    --text-dim: #a6adc8;
    --accent: #cba6f7;
    --green: #a6e3a1;
    --blue: #89b4fa;
    --red: #f38ba8;
    --font: system-ui, -apple-system, sans-serif;
    --radius: 8px;
    --sidebar-w: 200px;
}

body { font-family: var(--font); background: var(--bg); color: var(--text); font-size: 14px; line-height: 1.5; }

/* ── Layout ── */
.layout { display: flex; height: 100vh; overflow: hidden; }

.sidebar {
    width: var(--sidebar-w);
    background: var(--bg);
    border-right: 1px solid var(--surface);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
}

.sidebar-header {
    padding: 18px 16px 14px;
    font-weight: 700;
    font-size: 15px;
    color: var(--accent);
    border-bottom: 1px solid var(--surface);
    letter-spacing: 0.3px;
}

.sidebar-nav { padding: 10px 8px; }

.nav-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 10px 12px;
    border: none;
    border-radius: var(--radius);
    background: transparent;
    color: var(--text-dim);
    font-size: 13px;
    cursor: pointer;
    text-align: left;
    margin-bottom: 2px;
    transition: background 0.15s, color 0.15s;
}

.nav-item:hover { background: var(--surface); color: var(--text); }
.nav-item.active { background: var(--surface); color: var(--accent); font-weight: 600; }

.main { flex: 1; overflow-y: auto; padding: 28px 32px; }

/* ── Tabs ── */
.tab-content { display: block; }
.tab-content.hidden { display: none; }

/* ── Sections ── */
.section { margin-bottom: 22px; }
.section-title { font-size: 14px; font-weight: 600; color: var(--accent); margin-bottom: 10px; }
.optional { color: var(--muted); font-weight: 400; font-size: 12px; }

/* ── Upload zone ── */
.upload-zone {
    border: 2px dashed var(--border);
    border-radius: var(--radius);
    padding: 14px 18px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    transition: border-color 0.15s, background 0.15s;
}

.upload-zone.drag-over { border-color: var(--accent); background: rgba(203, 166, 247, 0.05); }
.upload-hint { color: var(--muted); font-size: 13px; }

.upload-status { margin-top: 6px; font-size: 13px; min-height: 18px; }
.upload-status.success { color: var(--green); }
.upload-status.error { color: var(--red); }

/* ── Params row ── */
.params-row { display: flex; align-items: flex-end; gap: 28px; flex-wrap: wrap; }
.param-group { display: flex; flex-direction: column; gap: 6px; }
.param-label { font-size: 12px; color: var(--muted); }

.slider-row { display: flex; align-items: center; gap: 10px; }
input[type="range"] { width: 130px; accent-color: var(--accent); }

/* ── Inputs ── */
.input {
    background: var(--bg-alt);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    padding: 7px 10px;
    font-size: 13px;
    font-family: var(--font);
    outline: none;
    transition: border-color 0.15s;
}

.input:focus { border-color: var(--accent); }
input[type="number"].input { width: 120px; }

.textarea {
    background: var(--bg-alt);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    padding: 10px 12px;
    font-size: 13px;
    font-family: var(--font);
    resize: vertical;
    width: 100%;
    outline: none;
    transition: border-color 0.15s;
}

.textarea:focus { border-color: var(--accent); }
#instructions { min-height: 72px; }
#chat-input { min-height: 48px; max-height: 160px; resize: none; }

/* ── Buttons ── */
.btn {
    border: none;
    border-radius: var(--radius);
    padding: 9px 22px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    font-family: var(--font);
    transition: opacity 0.15s;
    white-space: nowrap;
}

.btn:disabled { opacity: 0.45; cursor: not-allowed; }
.btn-primary { background: var(--accent); color: var(--bg); }
.btn-secondary { background: var(--surface); color: var(--text); border: 1px solid var(--border); }
.btn-success { background: var(--green); color: var(--bg); padding: 6px 14px; font-size: 12px; }
.btn-apply { background: var(--blue); color: var(--bg); margin-top: 8px; }

/* ── Error banner ── */
.error-banner {
    background: rgba(243, 139, 168, 0.12);
    border: 1px solid var(--red);
    border-radius: var(--radius);
    color: var(--red);
    padding: 10px 14px;
    font-size: 13px;
    margin-top: 10px;
}

.error-banner.hidden { display: none; }

/* ── Preview tables ── */
.table-card {
    background: var(--bg-alt);
    border: 1px solid var(--surface);
    border-radius: var(--radius);
    overflow: hidden;
    margin-bottom: 14px;
}

.card-header {
    padding: 10px 14px;
    background: var(--surface);
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-weight: 600;
    font-size: 13px;
}

.card-title { color: var(--text); }
.card-row-count { color: var(--muted); font-size: 11px; font-weight: 400; }

.table-wrap { overflow-x: auto; }

.preview-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
}

.preview-table th {
    padding: 6px 12px;
    text-align: left;
    color: var(--muted);
    background: #24273a;
    font-weight: 500;
    border-bottom: 1px solid var(--surface);
}

.preview-table td {
    padding: 6px 12px;
    border-top: 1px solid var(--surface);
    color: var(--text);
}

.card-footer {
    padding: 10px 14px;
    border-top: 1px solid var(--surface);
    display: flex;
    gap: 8px;
    align-items: center;
}

.card-footer .input { flex: 1; padding: 6px 10px; font-size: 12px; }

/* ── Modal ── */
.modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
}

.modal-overlay.hidden { display: none; }

.modal {
    background: var(--bg-alt);
    border: 1px solid var(--surface);
    border-radius: 12px;
    padding: 28px;
    width: 360px;
    display: flex;
    flex-direction: column;
    gap: 14px;
}

.modal-title { font-size: 16px; font-weight: 700; color: var(--accent); }
.modal-actions { display: flex; gap: 10px; justify-content: flex-end; }

/* ── Toast ── */
.toast {
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: var(--green);
    color: var(--bg);
    border-radius: var(--radius);
    padding: 12px 20px;
    font-weight: 600;
    font-size: 13px;
    z-index: 200;
    animation: slide-in 0.2s ease;
}

@keyframes slide-in {
    from { transform: translateY(12px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
}

/* ── Chat ── */
.empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 50vh;
    color: var(--muted);
    font-size: 15px;
}

.chat-container { display: flex; flex-direction: column; height: calc(100vh - 56px); }
.chat-container.hidden { display: none; }

.chat-context {
    padding: 10px 0 14px;
    font-size: 12px;
    color: var(--muted);
    border-bottom: 1px solid var(--surface);
    margin-bottom: 16px;
}

.chat-messages { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; padding-bottom: 16px; }

.bubble {
    max-width: 70%;
    padding: 10px 14px;
    border-radius: var(--radius);
    font-size: 13px;
    line-height: 1.55;
    white-space: pre-wrap;
}

.bubble-user {
    align-self: flex-end;
    background: var(--surface);
    border-radius: 8px 0 8px 8px;
}

.bubble-assistant {
    align-self: flex-start;
    background: var(--bg-alt);
    border: 1px solid var(--surface);
    border-radius: 0 8px 8px 8px;
}

.bubble.error { color: var(--red); border-color: var(--red); }

.chat-input-bar {
    display: flex;
    gap: 10px;
    align-items: flex-end;
    padding-top: 14px;
    border-top: 1px solid var(--surface);
}

.chat-input-bar .btn { flex-shrink: 0; height: fit-content; }
```

- [ ] **Step 2: Verify styling**

Open http://localhost:3000. Expected: dark sidebar, content area visible, tab switching highlights the active nav item.

- [ ] **Step 3: Commit**

```bash
git add style.css
git commit -m "feat: add CSS styles (dark Catppuccin-inspired theme)"
```

---

## Task 7: Upload section + parameters (generate.js part 1)

**Repo:** `syntheticDataGenerator-ui`

**Files:**
- Modify: `js/generate.js`

- [ ] **Step 1: Implement upload + parameters in generate.js**

Replace the contents of `js/generate.js` with:

```javascript
/* ── State ── */
const state = window.appState;

/* ── DOM ── */
const uploadZone       = document.getElementById('upload-zone');
const browseBtn        = document.getElementById('browse-btn');
const fileInput        = document.getElementById('file-input');
const uploadStatus     = document.getElementById('upload-status');
const instructionsEl   = document.getElementById('instructions');
const temperatureEl    = document.getElementById('temperature');
const temperatureValue = document.getElementById('temperature-value');
const maxTokensEl      = document.getElementById('max-tokens');
const generateBtn      = document.getElementById('generate-btn');
const generateError    = document.getElementById('generate-error');
const previewSection   = document.getElementById('preview-section');
const previewTables    = document.getElementById('preview-tables');
const applyBtn         = document.getElementById('apply-btn');
const applyModal       = document.getElementById('apply-modal');
const modalCancel      = document.getElementById('modal-cancel');
const modalConfirm     = document.getElementById('modal-confirm');
const rowsPerTableEl   = document.getElementById('rows-per-table');
const applyError       = document.getElementById('apply-error');

/* ── Upload ── */
browseBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFileSelect(fileInput.files[0]);
});

uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
});

uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));

uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) handleFileSelect(e.dataTransfer.files[0]);
});

async function handleFileSelect(file) {
    uploadStatus.textContent = 'Uploading…';
    uploadStatus.className = 'upload-status';
    generateBtn.disabled = true;
    try {
        const { id } = await uploadFile(file);
        state.fileId = id;
        uploadStatus.textContent = `✓ ${file.name} uploaded`;
        uploadStatus.className = 'upload-status success';
        generateBtn.disabled = false;
    } catch (err) {
        uploadStatus.textContent = err.message;
        uploadStatus.className = 'upload-status error';
    }
}

/* ── Temperature slider ── */
temperatureEl.addEventListener('input', () => {
    temperatureValue.textContent = temperatureEl.value;
});
```

- [ ] **Step 2: Verify upload works end-to-end**

With the Django backend running (`docker compose up`), open http://localhost:3000. Drop a `.sql` file into the upload zone or use Browse. Expected: green "✓ filename.sql uploaded" status, Generate button becomes enabled.

- [ ] **Step 3: Commit**

```bash
git add js/generate.js
git commit -m "feat: implement file upload and parameters UI"
```

---

## Task 8: Generate SSE + preview tables (generate.js part 2)

**Repo:** `syntheticDataGenerator-ui`

**Files:**
- Modify: `js/generate.js`

- [ ] **Step 1: Append generate + preview logic to generate.js**

Append to `js/generate.js`:

```javascript
/* ── Generate ── */
generateBtn.addEventListener('click', startGeneration);

async function startGeneration() {
    generateBtn.disabled = true;
    generateError.classList.add('hidden');
    previewSection.classList.add('hidden');
    previewTables.innerHTML = '';
    state.previewData = {};
    state.generatedId = null;
    applyBtn.classList.add('hidden');

    const temperature = temperatureEl.value;
    const maxTokens = maxTokensEl.value || null;
    const es = openGenerateStream(state.fileId, temperature, maxTokens);

    es.onmessage = async (e) => {
        const event = JSON.parse(e.data);
        if (event.event === 'start') {
            state.generatedId = event.generatedId;
            previewSection.classList.remove('hidden');
        } else if (event.event === 'row') {
            if (!state.previewData[event.table]) {
                state.previewData[event.table] = [];
                renderTableCard(event.table);
            }
            state.previewData[event.table].push(event.row);
            updateTableCard(event.table);
        } else if (event.event === 'done') {
            es.close();
            applyBtn.classList.remove('hidden');
            generateBtn.disabled = false;
            const instructions = instructionsEl.value.trim();
            if (instructions) await applyInstructions(instructions);
        } else if (event.event === 'error') {
            es.close();
            generateError.textContent = event.message;
            generateError.classList.remove('hidden');
            generateBtn.disabled = false;
        }
    };

    es.onerror = () => {
        es.close();
        generateError.textContent = 'Connection lost. Please try again.';
        generateError.classList.remove('hidden');
        generateBtn.disabled = false;
    };
}

function renderTableCard(tableName) {
    const card = document.createElement('div');
    card.className = 'table-card';
    card.id = `card-${tableName}`;
    card.innerHTML = `
        <div class="card-header">
            <span class="card-title">📋 ${tableName}</span>
            <span class="card-row-count" id="count-${tableName}">0 rows</span>
        </div>
        <div class="table-wrap" id="table-wrap-${tableName}"></div>
        <div class="card-footer">
            <input type="text" class="input" id="modify-input-${tableName}"
                   placeholder="Modify… e.g. use only female names">
            <button class="btn btn-success" id="modify-btn-${tableName}">Submit</button>
        </div>
        <div class="error-banner hidden" id="modify-error-${tableName}"></div>
    `;
    previewTables.appendChild(card);
    document.getElementById(`modify-btn-${tableName}`)
        .addEventListener('click', () => submitModify(tableName));
}

function updateTableCard(tableName) {
    const rows = state.previewData[tableName];
    document.getElementById(`count-${tableName}`).textContent = `${rows.length} rows`;
    if (!rows.length) return;
    const cols = Object.keys(rows[0]);
    const thead = `<thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead>`;
    const tbody = `<tbody>${rows.map(r =>
        `<tr>${cols.map(c => `<td>${r[c] ?? ''}</td>`).join('')}</tr>`
    ).join('')}</tbody>`;
    document.getElementById(`table-wrap-${tableName}`).innerHTML =
        `<table class="preview-table">${thead}${tbody}</table>`;
}

async function applyInstructions(prompt) {
    const spinner = document.createElement('p');
    spinner.id = 'instructions-spinner';
    spinner.style.cssText = 'color:var(--muted);font-size:13px;margin-bottom:12px;';
    spinner.textContent = 'Applying instructions…';
    previewSection.insertBefore(spinner, previewSection.firstChild);
    try {
        await runModify(prompt);
    } finally {
        spinner.remove();
    }
}
```

- [ ] **Step 2: Verify SSE streaming**

Upload a schema, click Generate. Expected: preview section appears, table cards populate row by row as SSE events arrive. Row count badge updates. After all rows arrive, Apply button appears.

- [ ] **Step 3: Commit**

```bash
git add js/generate.js
git commit -m "feat: implement generate SSE streaming and preview table rendering"
```

---

## Task 9: Modify per-table + Apply modal (generate.js part 3)

**Repo:** `syntheticDataGenerator-ui`

**Files:**
- Modify: `js/generate.js`

- [ ] **Step 1: Append modify + apply logic to generate.js**

Append to `js/generate.js`:

```javascript
/* ── Modify ── */
async function submitModify(tableName) {
    const input    = document.getElementById(`modify-input-${tableName}`);
    const errorEl  = document.getElementById(`modify-error-${tableName}`);
    const btn      = document.getElementById(`modify-btn-${tableName}`);
    const prompt   = input.value.trim();
    if (!prompt) return;

    btn.disabled = true;
    errorEl.classList.add('hidden');
    try {
        await runModify(prompt);
        input.value = '';
    } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
    } finally {
        btn.disabled = false;
    }
}

async function runModify(prompt) {
    for (const t of Object.keys(state.previewData)) {
        state.previewData[t] = [];
        const wrap = document.getElementById(`table-wrap-${t}`);
        if (wrap) wrap.innerHTML = '';
        const count = document.getElementById(`count-${t}`);
        if (count) count.textContent = '0 rows';
    }
    const stream = await modifyData(state.generatedId, prompt);
    for await (const event of readSSE(stream)) {
        if (event.event === 'row') {
            if (!state.previewData[event.table]) {
                state.previewData[event.table] = [];
                renderTableCard(event.table);
            }
            state.previewData[event.table].push(event.row);
            updateTableCard(event.table);
        } else if (event.event === 'error') {
            throw new Error(event.message);
        }
    }
}

/* ── Apply modal ── */
applyBtn.addEventListener('click', () => applyModal.classList.remove('hidden'));
modalCancel.addEventListener('click', () => applyModal.classList.add('hidden'));
modalConfirm.addEventListener('click', confirmApply);

async function confirmApply() {
    const rowsPerTable = parseInt(rowsPerTableEl.value, 10);
    if (!rowsPerTable || rowsPerTable < 1 || rowsPerTable > 1000) {
        applyError.textContent = 'Enter a number between 1 and 1000.';
        applyError.classList.remove('hidden');
        return;
    }
    applyError.classList.add('hidden');
    modalConfirm.disabled = true;
    try {
        await applyData(state.generatedId, state.fileId, rowsPerTable);
        applyModal.classList.add('hidden');
        showToast('Data applied to database successfully.');
    } catch (err) {
        applyError.textContent = err.message;
        applyError.classList.remove('hidden');
    } finally {
        modalConfirm.disabled = false;
    }
}

function showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}
```

- [ ] **Step 2: Verify modify flow**

After generating data, type a prompt into a table card (e.g., "Use only Russian names") and click Submit. Expected: table rows clear and re-populate with modified data.

- [ ] **Step 3: Verify apply modal**

Click "Apply to Database". Expected: modal opens with rows-per-table input. Cancel closes modal. Confirm sends request to backend; on success a green toast appears bottom-right.

- [ ] **Step 4: Commit**

```bash
git add js/generate.js
git commit -m "feat: implement per-table modify and apply modal"
```

---

## Task 10: Chat tab (chat.js)

**Repo:** `syntheticDataGenerator-ui`

**Files:**
- Modify: `js/chat.js`

- [ ] **Step 1: Implement chat.js**

Replace the contents of `js/chat.js` with:

```javascript
const state = window.appState;

const chatEmpty     = document.getElementById('chat-empty');
const chatContainer = document.getElementById('chat-container');
const chatContext   = document.getElementById('chat-context');
const chatMessages  = document.getElementById('chat-messages');
const chatInput     = document.getElementById('chat-input');
const sendBtn       = document.getElementById('send-btn');

let chatHistory = [];

function refreshChatTab() {
    if (!state.generatedId) {
        chatEmpty.classList.remove('hidden');
        chatContainer.classList.add('hidden');
    } else {
        chatEmpty.classList.add('hidden');
        chatContainer.classList.remove('hidden');
        const tables = Object.keys(state.previewData).join(', ') || 'no tables';
        chatContext.textContent = `Context loaded: schema + preview data (${tables})`;
    }
}

/* Hook into tab switching defined in index.html */
document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
        if (btn.dataset.tab === 'chat') refreshChatTab();
    });
});

sendBtn.addEventListener('click', sendMessage);

chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text || sendBtn.disabled) return;

    chatInput.value = '';
    sendBtn.disabled = true;

    appendBubble('user', text);
    const assistantBubble = appendBubble('assistant', '');

    try {
        const stream = await sendChatMessage(state.generatedId, text, chatHistory);
        let fullResponse = '';

        for await (const event of readSSE(stream)) {
            if (event.event === 'chunk') {
                fullResponse += event.text;
                assistantBubble.textContent = fullResponse;
                chatMessages.scrollTop = chatMessages.scrollHeight;
            } else if (event.event === 'error') {
                assistantBubble.textContent = `Error: ${event.message}`;
                assistantBubble.classList.add('error');
                sendBtn.disabled = false;
                return;
            }
        }

        chatHistory.push({ role: 'user', content: text });
        chatHistory.push({ role: 'assistant', content: fullResponse });
    } catch (err) {
        assistantBubble.textContent = `Error: ${err.message}`;
        assistantBubble.classList.add('error');
    } finally {
        sendBtn.disabled = false;
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}

function appendBubble(role, text) {
    const bubble = document.createElement('div');
    bubble.className = `bubble bubble-${role}`;
    bubble.textContent = text;
    chatMessages.appendChild(bubble);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return bubble;
}
```

- [ ] **Step 2: Verify empty state**

Open http://localhost:3000, click "Talk to your data" without having generated data. Expected: "Generate data first to enable chat." message shown.

- [ ] **Step 3: Verify chat with generated data**

Generate data on the Data Generation tab, then switch to Talk to your data. Expected: context banner shows loaded tables, input is active. Type a message and press Send. Expected: user bubble appears immediately, assistant bubble fills in character by character as the stream arrives.

- [ ] **Step 4: Verify conversation history**

Send two messages in sequence. Expected: second response is contextually aware of the first exchange (the backend receives the history array).

- [ ] **Step 5: Commit**

```bash
git add js/chat.js
git commit -m "feat: implement Talk to Your Data chat tab with streaming"
```
