/**
 * Pi RPC Server - Frontend JavaScript Client
 * Handles WebSocket connections and real-time messaging
 */

class PiClient {
    constructor(baseUrl = window.location.origin) {
        this.baseUrl = baseUrl;
        this.sessionId = null;
        this.ws = null;
        this.retryCount = 0;
        this.maxRetries = 5;
        this.messageHistory = [];
        this.isAgentConnected = false;
        
        this.init();
    }

    init() {
        this.bindEvents();
        this.connect();
        this.updateStatus('Connecting agent...', false);
    }

    bindEvents() {
        // Send button
        document.getElementById('send-btn').addEventListener('click', () => this.sendPrompt());

        // Enter key to send (Shift+Enter for new line)
        document.getElementById('prompt-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendPrompt();
            }
        });

        // Clear button
        document.getElementById('clear-btn').addEventListener('click', () => this.clearMessages());
    }

    connect() {
        // Create or reuse session
        this.sessionId = 'session-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now();
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${this.baseUrl.split('://')[1]}/ws/${this.sessionId}`;
        
        this.updateStatus('Connecting WebSocket...', false);
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            this.retryCount = 0;
            console.log('WebSocket opened to:', wsUrl);
            this.updateStatus('WebSocket connected!', true);
            
            // Create agent session in the background
            this.createAgentSession();
        };

        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            console.log('Received WebSocket message:', data.type, data);
            this.handleEvent(data);
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.updateStatus('Connection error', false);
        };

        this.ws.onclose = () => {
            this.updateStatus('WebSocket closed', false);
            this.handleDisconnect();
        };
    }

    handleDisconnect() {
        if (this.retryCount < this.maxRetries) {
            this.retryCount++;
            const delay = Math.min(1000 * Math.pow(2, this.retryCount), 10000);
            console.log(`Reconnecting in ${delay}ms... (${this.retryCount}/${this.maxRetries})`);
            this.updateStatus(`Reconnecting... (${this.retryCount})`, false);
            
            setTimeout(() => this.connect(), delay);
        } else {
            this.updateStatus('Max reconnection attempts reached', false);
        }
    }

    createAgentSession() {
        // We'll create the session via REST API, but we need to associate it with our WS session
        // For now, just wait for the agent to be ready
        
        // Check if the agent is responding via our WebSocket
        setTimeout(() => {
            // Send a test command to verify the agent is ready
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.sendCommand({
                    type: 'get_state',
                    id: 'test-state'
                });
            }
        }, 1000);
    }

    handleEvent(event) {
        console.log('Processing event:', event);

        if (event.type === 'response') {
            if (event.command === 'get_state') {
                if (event.success) {
                    this.isAgentConnected = true;
                    this.updateStatus('Agent connected! You can now chat.', true);
                } else if (event.command === 'get_state') {
                    console.log('Agent state query failed, agent may be initializing');
                }
            }
        }
        
        switch (event.type) {
            case 'message_update':
                this.renderMessageUpdate(event);
                break;

            case 'message_end':
                this.updateStatus('Response complete', true);
                break;

            case 'agent_end':
                this.messageHistory = event.messages;
                this.addMessage({
                    type: 'assistant',
                    content: this.formatAgentMessage(event.messages),
                    timestamp: Date.now()
                });
                break;

            case 'tool_execution_start':
                // Tool call started
                break;

            case 'tool_execution_end':
                // Tool call completed
                break;

            case 'turn_start':
                break;

            case 'turn_end':
                break;

            case 'error':
                this.updateStatus(`Error: ${event.errorMessage}`, false);
                break;
                
            case 'agent_start':
                this.updateStatus('Agent is starting...', false);
                break;
                
            case 'agent_end':
                this.updateStatus('Agent processing complete', true);
                break;
        }
    }

    renderMessageUpdate(event) {
        const delta = event.assistantMessageEvent.delta;
        if (event.assistantMessageEvent.type === 'text_delta') {
            this.addTyping(delta);
        }
    }

    formatAgentMessage(messages) {
        let content = '';
        messages.forEach(msg => {
            if (msg.role === 'assistant') {
                const textContents = msg.content
                    .filter(c => c.type === 'text')
                    .map(c => c.text);
                content += textContents.join('');
            }
        });
        return content;
    }

    addMessage(msg) {
        const messageEl = document.createElement('div');
        messageEl.className = `message ${msg.type}`;
        messageEl.innerHTML = `
            <div class="message-timestamp">${new Date(msg.timestamp).toLocaleTimeString()}</div>
            <div class="message-content">${this.escapeHtml(msg.content)}</div>
        `;
        
        this.messageHistory.push(msg);
        document.getElementById('message-history').appendChild(messageEl);
        this.scrollToBottom();
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    addTyping(text) {
        let lastMsg = document.querySelector('.message.assistant:last-child');
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
        const container = document.getElementById('message-history');
        container.scrollTop = container.scrollHeight;
    }

    clearMessages() {
        document.getElementById('message-history').innerHTML = '';
        this.messageHistory = [];
    }

    updateStatus(text, isOnline) {
        const indicator = document.getElementById('status-indicator');
        const statusText = document.getElementById('connection-status');
        
        statusText.textContent = text;
        indicator.classList.toggle('connected', isOnline);
        
        if (!isOnline) {
            indicator.style.backgroundColor = '#ff4444';
        } else {
            indicator.style.backgroundColor = '#4ec9b0';
        }
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

        // Send via WebSocket
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.updateStatus('Agent is thinking...', false);
            
            this.sendCommand({
                type: 'prompt',
                message: message,
                streamingBehavior: 'steer',
                id: 'req-' + Date.now()
            });
            
            // Re-enable after delay
            setTimeout(() => {
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    input.disabled = false;
                    input.focus();
                }
            }, 1000);
        } else {
            this.addMessage({
                type: 'assistant',
                content: 'Error: Not connected. Refresh the page.',
                timestamp: Date.now()
            });
        }
    }

    sendCommand(command) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.addMessage({
                type: 'assistant',
                content: 'Error: WebSocket not connected.',
                timestamp: Date.now()
            });
            return;
        }
        
        try {
            this.ws.send(JSON.stringify(command));
            console.log('Sent WebSocket message:', command);
        } catch (e) {
            console.error('Failed to send:', e);
            this.addMessage({
                type: 'assistant',
                content: 'Error sending message: ' + e.message,
                timestamp: Date.now()
            });
        }
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    new PiClient();
});
