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
        
        this.init();
    }

    init() {
        this.bindEvents();
        this.connect();
        this.updateStatus('Connecting...', false);
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
        if (!this.sessionId) {
            this.sessionId = 'session-' + Date.now();
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${this.baseUrl.split('://')[1]}/ws/${this.sessionId}`;
        
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            this.retryCount = 0;
            this.updateStatus('Connected! Ready to chat with Pi', true);
            this.createSession();
        };

        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleEvent(data);
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.updateStatus('Connection error', false);
        };

        this.ws.onclose = () => {
            this.updateStatus('Disconnected', false);
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
        }
    }

    createSession() {
        // Create a new PI session via REST API
        fetch(`${this.baseUrl}/api/sessions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                provider: 'anthropic',
                model_id: 'claude-sonnet-4-20250514'
            })
        })
        .then(res => res.json())
        .then(data => {
            if (data.session_id) {
                console.log('Session created:', data.session_id);
                this.updateStatus('Connected to Pi Agent', true);
            }
        })
        .catch(err => {
            console.error('Failed to create session:', err);
            this.updateStatus('Session creation failed', false);
        });
    }

    handleEvent(event) {
        console.log('Received event:', event.type, event);

        switch (event.type) {
            case 'response':
                // Session creation confirmation
                if (event.command === 'create' || event.success) {
                    // Already handled
                }
                break;

            case 'message_update':
                this.renderMessageUpdate(event);
                break;

            case 'message_end':
                this.updateStatus('Agent response complete', true);
                break;

            case 'agent_end':
                this.messageHistory = event.messages;
                this.addMessage({
                    type: 'assistant',
                    content: this.formatAgentMessage(event.messages),
                    timestamp: Date.now()
                });
                break;

            case 'turn_end':
                // Tool calls and results
                break;

            case 'tool_execution_start':
                break;

            case 'tool_execution_end':
                break;

            case 'error':
                this.updateStatus(`Error: ${event.errorMessage}`, false);
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
                content += ' '.join(msg.content
                    .filter(c => c.type === 'text')
                    .map(c => c.text)
                );
            }
        });
        return content;
    }

    addMessage(msg) {
        const messageEl = document.createElement('div');
        messageEl.className = `message ${msg.type}`;
        messageEl.innerHTML = `
            <div class="message-timestamp">${new Date(msg.timestamp).toLocaleTimeString()}</div>
            <div class="message-content">${msg.content}</div>
        `;
        
        this.messageHistory.push(msg);
        document.getElementById('message-history').appendChild(messageEl);
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
        
        // Strip timestamp from last message
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
            this.ws.send(JSON.stringify({
                type: 'command',
                command: {
                    type: 'prompt',
                    message: message,
                    streamingBehavior: 'steer',
                    id: 'req-' + Date.now()
                }
            }));

            this.updateStatus('Agent is thinking...', false);

            // Re-enable after small delay
            setTimeout(() => {
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    input.disabled = false;
                    input.focus();
                    
                    // Check for streaming (might take time)
                    setTimeout(() => {
                        if (input.disabled && !document.querySelector('.message.assistant')) {
                            // Still showing typing indicator
                        } else {
                            input.disabled = false;
                        }
                    }, 5000);
                }
            }, 1000);
        } else {
            this.addMessage({
                type: 'assistant',
                content: 'Error: WebSocket not connected. Please refresh.',
                timestamp: Date.now()
            });
        }
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    new PiClient();
});
