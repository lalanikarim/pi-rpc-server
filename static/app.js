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
    
    toggleCustomPath() {
        const select = document.getElementById('cwd-select');
        const customInput = document.getElementById('custom-path-input');
        
        if (select.value === 'custom') {
            customInput.classList.add('active');
            document.getElementById('custom-path').focus();
        } else {
            customInput.classList.remove('active');
        }
    }
    
    getCurrentCwd() {
        const select = document.getElementById('cwd-select');
        const customPath = document.getElementById('custom-path');
        
        if (select.value === 'custom' && customPath.value.trim()) {
            return customPath.value.trim();
        }
        return select.value;
    }
    
    async loadSessionsAvailable() {
        const cwd = this.getCurrentCwd();
        if (!cwd) {
            alert('Please select or enter a working directory.');
            return;
        }
        
        const loadBtn = document.getElementById('load-sessions');
        loadBtn.textContent = 'Loading...';
        loadBtn.disabled = true;
        
        try {
            const response = await fetch(`${this.baseUrl}/api/sessions/available?cwd=${encodeURIComponent(cwd)}`);
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
                    option.textContent = `[Agent] ${session.name || 'Unnamed'} (${this.shortenPath(session.path)})`;
                    select.appendChild(option);
                });
            } else {
                const option = document.createElement('option');
                option.value = 'new';
                option.textContent = 'No agent sessions in this directory';
                select.appendChild(option);
                select.addEventListener('change', () => {});
            }
            
            document.getElementById('available-sessions').style.display = 'block';
            
            const title = document.getElementById('available-sessions').querySelector('h3');
            title.textContent = `Available Agents in: ${this.shortenPath(cwd)}`;
            
        } catch (err) {
            console.error('Failed to load sessions:', err);
            alert('Failed to load sessions: ' + err.message);
        } finally {
            loadBtn.textContent = 'Load Available Agents';
            loadBtn.disabled = false;
        }
    }
    
    shortenPath(path) {
        if (!path) return '';
        const parts = path.split('/');
        if (parts.length > 3) {
            return `.../${parts.slice(-2).join('/')}`;
        }
        return path;
    }
    
    onAgentSelect() {}
    
    async startSession() {
        const cwd = this.getCurrentCwd();
        const agentSelect = document.getElementById('agent-select');
        const agentValue = agentSelect.value;
        
        if (agentValue && agentValue !== 'new') {
            try {
                const agentInfo = JSON.parse(agentValue);
                this.sessionId = agentInfo.id;
                document.getElementById('setup-panel').style.display = 'none';
                document.getElementById('session-ui').classList.add('active');
                await this.initWebSocket();
                setTimeout(() => this.loadModels(), 500);
            } catch (e) {
                console.error('Failed to parse agent selection:', e);
            }
        } else {
            const createBtn = document.querySelector('#available-sessions button');
            createBtn.textContent = 'Creating...';
            createBtn.disabled = true;
            
            try {
                const response = await fetch(`${this.baseUrl}/api/sessions?cwd=${encodeURIComponent(cwd)}&provider=anthropic&model_id=claude-sonnet-4-20250514`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        provider: 'anthropic',
                        model_id: 'claude-sonnet-4-20250514'
                    })
                });
                
                const data = await response.json();
                
                if (data.session_id) {
                    this.sessionId = data.session_id;
                    document.getElementById('setup-panel').style.display = 'none';
                    document.getElementById('session-ui').classList.add('active');
                    await this.initWebSocket();
                    setTimeout(() => this.loadModels(), 500);
                }
            } catch (err) {
                console.error('Failed to create session:', err);
                alert('Failed to create session: ' + err.message);
                createBtn.textContent = 'Start Session';
                createBtn.disabled = false;
            }
        }
    }
    
    async initWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${this.baseUrl.split('://')[1]}/ws/${this.sessionId}`;
        
        this.ws = new WebSocket(wsUrl);
        this.ws.onopen = () => {
            this.updateConnectionBadge('connected');
            console.log('WebSocket connected');
        };
        
        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleWebSocketMessage(data);
        };
        
        this.ws.onclose = () => {
            this.updateConnectionBadge('disconnected');
        };
        
        this.ws.onerror = (err) => {
            console.error('WebSocket error:', err);
        };
    }
    
    async loadModels() {
        const select = document.getElementById('model-select');
        select.innerHTML = '<option value="">Loading...</option>';
        
        const response = await fetch(`${this.baseUrl}/api/sessions/${this.sessionId}/models`);
        const data = await response.json();
        
        select.innerHTML = '';
        
        console.log('Model load data:', data);
        
        if (data.success && data.models && data.models.length > 0) {
            data.models.forEach(model => {
                const provider = model.provider || 'anthropic';
                const modelId = model.id || '';
                const name = model.name || `${provider} - ${modelId}`;
                const value = `${provider}/${modelId}`;
                
                const option = document.createElement('option');
                option.value = value;
                option.textContent = name;
                
                // If no current model is set, select the first one
                if (!data.current && data.models.length === 75) {
                    console.log('Selecting first model as default');
                    this.selectedModel = modelId;
                    option.selected = true;
                } else if (!data.current && data.models.length > 0) {
                    // Select first available
                    if (data.models.indexOf(model) === 0) {
                        option.selected = true;
                        this.selectedModel = modelId;
                    }
                }
                
                select.appendChild(option);
            });
        } else {
            const option = document.createElement('option');
            option.disabled = true;
            option.textContent = 'No models available - check agent console';
            select.appendChild(option);
            
            console.warn('No models available from agent:', data);
        }
    }
    
    selectModel() {
        const modelOption = document.getElementById('model-select').value;
        if (!modelOption) return;
        
        const [provider, model_id] = modelOption.split('/');
        this.selectedModel = model_id;
        
        fetch(`${this.baseUrl}/api/sessions/${this.sessionId}/model`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                provider: provider || 'anthropic',
                model_id: model_id
            })
        })
        .then(res => res.json())
        .then(result => {
            if (result.success) {
                setTimeout(() => this.loadModels(), 1000);
            }
        })
        .catch(err => {
            console.error('Failed to set model:', err);
            alert('Failed to set model: ' + err.message);
            this.loadModels();
        });
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
        if (data.type === 'response' && data.command === 'get_state') {
            const currentModel = data.state?.model || data.state?.model?.model || {};
            if (currentModel?.id) {
                this.selectedModel = currentModel.id;
            }
        }
        
        if (data.type === 'message_update' && data.assistantMessageEvent?.type === 'text_delta') {
            this.addTyping(data.assistantMessageEvent.delta);
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

window.toggleCustomPath = () => window.piClient.toggleCustomPath();
window.loadSessionsAvailable = () => window.piClient.loadSessionsAvailable();
window.startSession = () => window.piClient.startSession();
window.selectModel = () => window.piClient.selectModel();
window.refreshModels = () => window.piClient.refreshModels();

document.addEventListener('DOMContentLoaded', () => {
    window.piClient = new PiClient();
});
