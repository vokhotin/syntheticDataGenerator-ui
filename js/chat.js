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
