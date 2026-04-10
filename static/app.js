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
    
    // Toggle custom path input visibility
    toggleCustomPath() {
        const select = document.getElementById('cwd-select');
        const customInput = document.getElementById('custom-path-input');
        
        if (select.value === 'custom') {
            customInput.classList.add('active');
            document.getElementById('custom-path').focus();
            // Disable the preset select since we're using custom input
        } else {
            customInput.classList.remove('active');
        }
    }
    
    // Toggle between custom input and preset select
    toggleInput() {
        const presetSelect = document.getElementById('cwd-select');
        const customInput = document.getElementById('custom-path-input');
        presetSelect.style.display = presetSelect.style.display === 'none' ? 'block' : 'none';
        customInput.classList.toggle('active');
    }
    
    // Get the currently selected/entered CWD
    getCurrentCwd() {
        const select = document.getElementById('cwd-select');
        const customPath = document.getElementById('custom-path');
        
        if (select.value === 'custom' && customPath.value.trim()) {
            return customPath.value.trim();
        }
        return select.value;
    }
    
    // Load available sessions from selected directory
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
                option.textContent = 'No sessions in this directory';
                select.appendChild(option);
                select.addEventListener('change', () => {});
            }
            
            document.getElementById('available-sessions').style.display = 'block';
            
            // Display the current directory being scanned
            const title = document.getElementById('available-sessions').querySelector('h3');
            title.textContent = `Available Agents in: ${this.shortenPath(cwd)}↬`;
            
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
    
    onAgentSelect() {
        // Handle agent selection logic
    }
    
    // Start session with selected CWD and agent (if any)
    async startSession() {
        const cwd = this.getCurrentCwd();
        const agentSelect = document.getElementById('agent-select');
        const agentValue = agentSelect.value;
        
        let agentId = null;
        
        // Check if user selected an existing agent
        if (agentValue && agentValue !== 'new') {
            try {
                const agentInfo = JSON.parse(agentValue);
                agentId = agentInfo.id;
                this.sessionId = agentId;
            } catch (e) {
                console.error('Failed to parse agent selection:', e);
            }
        }
        
        if (agentId) {
            // Use existing session - switch to it
            this.sessionId = agentId;
            
            // Switch to session UI immediately
            document.getElementById('setup-panel').style.display = 'none';
            document.getElementById('session-ui').classList.add('active');
            
            // Initialize WebSocket for this existing session
            await this.initWebSocket();
            
            // Try to load models for this session
            setTimeout(() => this.loadModels(), 500);
        } else {
            // Create a new agent session
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
                    
                    // Switch to session UI
                    document.getElementById('setup-panel').style.display = 'none';
                    document.getElementById('session-ui').classList.add('active');
                    
                    // Initialize WebSocket
                    await this.initWebSocket();
                    
                    // Load models
                    setTimeout(() => this.loadModels(), 500);
                }
            } catch (err) {
                console.error('Failed to create session:', err);
                alert('Failed to create session: ' + err.message);
                createBtn.textContent = 'Start Session ↬';
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
            console.log('WebSocket closed');
        };
        
        this.ws.onerror = (err) => {
            console.error('WebSocket error:', err);
        };
    }
    
    async loadModels() {
        try {
            const response = await fetch(`${this.baseUrl}/api/sessions/${this.sessionId}/state`);
            const data = await response.json();
            
            if (data.success && data.state) {
                const state = data.state;
                const currentModel = state.model || {};
                
                const select = document.getElementById('model-select');
                const models = [
                    {id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4'},
                    {id: 'claude-haiku-3-5-20241022', name: 'Claude Haiku 3.5'},
                    {id: 'gpt-4o', name: 'GPT-4o', provider: 'openai'},
                    {id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai'},
                ];
                
                select.innerHTML = '';
                models.forEach(m => {
                    const option = document.createElement('option');
                    option.value = `${m.provider || 'anthropic'}/${m.id}`;
                    option.textContent = m.name;
                    const currentId = currentModel.id;
                    option.selected = (currentId === m.id);
                    select.appendChild(option);
                });
                
                this.selectedModel = currentModel.id || models[0].id;
            }
        } catch (err) {
            console.error('Failed to load models:', err);
            // Set default models anyway for better UX
            const select = document.getElementById('model-select');
            const models = [
                {id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4'},
                {id: 'claude-haiku-3-5-20241022', name: 'Claude Haiku 3.5'},
                {id: 'gpt-4o', name: 'GPT-4o', provider: 'openai'},
                {id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai'},
            ];
            select.innerHTML = '';
            models.forEach(m => {
                const option = document.createElement('option');
                option.value = `${m.provider || 'anthropic'}/${m.id}`;
                option.textContent = m.name;
                select.appendChild(option);
            });
            this.selectedModel = 'claude-sonnet-4-20250514';
        }
    }
    
    selectModel() {
        const modelOption = document.getElementById('model-select').value;
        const [provider, model_id] = modelOption.split('\/');
        this.selectedModel = model_id;
        
        // Update the agent's model
        fetch(`${this.baseUrl}/api/sessions/${this.sessionId}/model`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                provider: provider || 'anthropic',
                model_id: model_id
            })
        }).catch(err => {
            console.error('Failed to set model:', err);
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

// Event handlers
function toggleCustomPath() { window.piClient.toggleCustomPath(); }
function loadSessionsAvailable() { window.piClient.loadSessionsAvailable(); }
function startSession() { window.piClient.startSession(); }
function selectModel() { window.piClient.selectModel(); }
function refreshModels() { window.piClient.refreshModels(); }

document.addEventListener('DOMContentLoaded', () => {
    window.piClient = new PiClient();
});
