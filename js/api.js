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
