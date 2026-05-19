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
