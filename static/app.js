/**
 * Pi RPC Server - Frontend JavaScript Client
 */

class PiClient {
    constructor() {
        this.baseUrl = window.location.origin;
        this.sessionId = null;
        this.ws = null;
        this.messageHistory = [];
        this.selectedCwd = null;
        this.init();
    }
    
    init() {
        this.bindEvents();
    }
    
    bindEvents() {
        document.getElementById('prompt-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendPrompt();
            }
        });
    }
    
    // Session Setup
    async loadSessionsAvailable() {
        try {
            const cwd = document.getElementById('cwd-select').value;
            const response = await fetch(`${this.baseUrl}/api/sessions/available?cwd=${cwd}`);
            const data = await response.json();
            
            const select = document.getElementById('agent-select');
            select.innerHTML = '<option value="">Create new agent...</option>';
            
            if (data.sessions && data.sessions.length > 0) {
                data.sessions.forEach(session => {
                    const option = document.createElement('option');
                    option.value = JSON.stringify({
                        id: session.id,
                        path: session.path,
                        name: session.name || 'Unnamed session'
                    });
                    option.textContent = `[Agent] ${session.name || 'Unnamed'} (${session.path.split('/').slice(-2).join('/')})`;
                    select.appendChild(option);
                });
            } else {
                const option = document.createElement('option');
                option.value = 'new';
                option.textContent = 'No sessions found - this is fine!';
                select.appendChild(option);
                select.addEventListener('change', onNewSessionCreation);
            }
            
            document.getElementById('available-sessions').style.display = 'block';
        } catch (err) {
            console.error('Failed to load sessions:', err);
            alert('Failed to load sessions: ' + err.message);
        }
    }
    
    onAgentSelect() {
        // Handle agent selection logic
    }
    
    async startSession() {
        const cwd = document.getElementById('cwd-select').value;
        const agentSelect = document.getElementById('agent-select');
        const agentValue = agentSelect.value;
        
        let model_id = 'claude-sonnet-4-20250514';
        let provider = 'anthropic';
        
        // Try to get existing session or create new one
        if (agentValue && agentValue !== 'new') {
            const agentInfo = JSON.parse(agentValue);
            this.sessionId = agentInfo.id;
            // We might need to switch to this session - for now use it as base
        } else {
            // Create new session
            const response = await fetch(`${this.baseUrl}/api/sessions?cwd=${cwd}&provider=anthropic&model_id=claude-sonnet-4-20250514`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    provider: 'anthropic',
                    model_id: model_id
                })
            });
            
            const data = await response.json();
            this.sessionId = data.session_id;
        }
        
        // Switch to session UI
        document.getElementById('setup-panel').style.display = 'none';
        document.getElementById('session-ui').classList.add('active');
        
        // Initialize WebSocket and load models
        await this.initWebSocket();
    }
    
    async initWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${this.baseUrl.split('://')[1]}/ws/${this.sessionId}`;
        
        this.ws = new WebSocket(wsUrl);
        this.ws.onopen = () => {
            this.updateConnectionBadge('connected');
            console.log('WebSocket connected');
            this.loadModels();
        };
        
        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleWebSocketMessage(data);
        };
        
        this.ws.onclose = () => {
            this.updateConnectionBadge('disconnected');
            console.log('WebSocket closed');
        };
        
        this.ws.onerror = (err) => {
            console.error('WebSocket error:', err);
        };
    }
    
    async loadModels() {
        try {
            // In RPC mode, we need to get models from the agent
            const response = await fetch(`${this.baseUrl}/api/sessions/${this.sessionId}/state`);
            const data = await response.json();
            
            if (data.success && data.state) {
                // Get model info from state
                const state = data.state;
                const currentModel = state.model || {};
                
                // For now, show available model options
                const select = document.getElementById('model-select');
                const models = [
                    {id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4'},
                    {id: 'claude-haiku-3-5-20241022', name: 'Claude Haiku 3.5'},
                    {id: 'gpt-4o', name: 'GPT-4o'},
                    {id: 'gpt-4o-mini', name: 'GPT-4o Mini'},
                ];
                
                select.innerHTML = '';
                models.forEach(m => {
                    const option = document.createElement('option');
                    option.value = m.id;
                    option.textContent = m.name;
                    option.selected = (m.id === currentModel.id);
                    select.appendChild(option);
                });
                
                this.selectedModel = currentModel.id;
            }
        } catch (err) {
            console.error('Failed to load models:', err);
        }
    }
    
    selectModel() {
        this.selectedModel = document.getElementById('model-select').value;
        // Update the agent's model
        fetch(`${this.baseUrl}/api/sessions/${this.sessionId}/model`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                provider: 'anthropic',
                model_id: this.selectedModel
            })
        }).catch(err => console.error('Failed to set model:', err));
    }
    
    refreshModels() {
        this.loadModels();
    }
    
    updateConnectionBadge(status) {
        const badge = document.getElementById('connection-badge');
        if (status === 'connected') {
            badge.className = 'badge connected';
            badge.textContent = 'Connected';
        } else {
            badge.className = 'badge disconnected';
            badge.textContent = 'Disconnected';
        }
    }
    
    handleWebSocketMessage(data) {
        console.log('Received:', data);
        
        if (data.type === 'response') {
            if (data.command === 'get_state' && data.success && data.data) {
                this.selectedCwd = data.data.cwd || null;
            }
        }
        
        if (data.type === 'message_update') {
            if (data.assistantMessageEvent.type === 'text_delta') {
                this.addTyping(data.assistantMessageEvent.delta);
            }
        }
        
        if (data.type === 'agent_end') {
            this.addMessage({
                type: 'assistant',
                content: this.extractTextFromMessages(data.messages),
                timestamp: Date.now()
            });
        }
    }
    
    extractTextFromMessages(messages) {
        let text = '';
        messages.forEach(msg => {
            if (msg.role === 'assistant') {
                const texts = msg.content?.filter(c => c.type === 'text').map(c => c.text) || [];
                text += texts.join('');
            }
        });
        return text;
    }
    
    sendPrompt() {
        const input = document.getElementById('prompt-input');
        const message = input.value.trim();
        if (!message) return;
        
        // Add user message
        this.addMessage({
            type: 'user',
            content: message,
            timestamp: Date.now()
        });
        
        input.value = '';
        input.disabled = true;
        
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'prompt',
                message: message,
                streamingBehavior: 'steer',
                id: 'req-' + Date.now()
            }));
        } else {
            this.addMessage({
                type: 'assistant',
                content: 'Error: Not connected',
                timestamp: Date.now()
            });
        }
        
        setTimeout(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                input.disabled = false;
            }
        }, 1000);
    }
    
    addMessage(msg) {
        const el = document.createElement('div');
        el.className = `message ${msg.type}`;
        el.innerHTML = `
            <div class="message-timestamp">${new Date(msg.timestamp).toLocaleTimeString()}</div>
            <div class="message-content">${this.escapeHtml(msg.content)}</div>
        `;
        document.getElementById('message-history').appendChild(el);
        this.scrollToBottom();
    }
    
    addTyping(text) {
        let lastMsg = Array.from(document.querySelectorAll('.message.assistant')).pop();
        if (!lastMsg) {
            lastMsg = document.createElement('div');
            lastMsg.className = 'message assistant';
            lastMsg.innerHTML = '<div class="message-timestamp"></div><div class="message-content"></div>';
            document.getElementById('message-history').appendChild(lastMsg);
        }
        lastMsg.querySelector('.message-timestamp').textContent = new Date().toLocaleTimeString();
        lastMsg.querySelector('.message-content').textContent += text;
        this.scrollToBottom();
    }
    
    scrollToBottom() {
        document.getElementById('message-history').scrollTop = 
            document.getElementById('message-history').scrollHeight;
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

function onNewSessionCreation() {
    // Default behavior - create new session
    startSession();
}

document.addEventListener('DOMContentLoaded', () => {
    window.piClient = new PiClient();
});

function loadSessionsAvailable() {
    window.piClient.loadSessionsAvailable();
}

function startSession() {
    window.piClient.startSession();
}

function selectModel() {
    window.piClient.selectModel();
}

function refreshModels() {
    window.piClient.refreshModels();
}
