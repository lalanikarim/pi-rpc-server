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
        this.modelLoadingCallbacks = [];
        this.loadModelsDeferred = null;
        this.isStreaming = false;
        this.streamingStarted = false; // Track if we started streaming for this message
        this.init();
    }
    
    // Directory browser methods
    async init() {
        await this.loadInitialDirectory();
        this.bindEvents();
    }
    
    async loadInitialDirectory() {
        // Try to detect home directory
        const defaultHome = '/Users/karim';
        
        try {
            const testPath = await fetch(`${this.baseUrl}/api/browse?path=${encodeURIComponent(defaultHome)}`);
            const data = await testPath.json();
            // If the directory exists and has entries, use it
            if (testPath.ok && !data.error) {
                window.homeDir = defaultHome;
            } else {
                window.homeDir = '/';
            }
        } catch (err) {
            console.warn('Could not detect home directory, using /');
            window.homeDir = '/';
        }
    }
    
    toggleDirectoryBrowser() {
        const container = document.getElementById('directory-browser-container');
        const isSelected = container.style.display === 'flex';
        container.style.display = isSelected ? 'none' : 'flex';
        
        if (!isSelected) {
            this.loadDirectoryTree(window.homeDir || '/Users/karim');
        }
    }
    
    async loadDirectoryTree(path) {
        try {
            const response = await fetch(`${this.baseUrl}/api/browse?path=${encodeURIComponent(path)}`);
            const data = await response.json();
            
            if (!data || !data.entries) {
                throw new Error('Failed to load directory');
            }
            
            const treeContainer = document.getElementById('directory-tree-tree');
            treeContainer.innerHTML = this.renderDirectoryEntries(data.entries, path);
            
            document.getElementById('current-path').textContent = path;
            
        } catch (err) {
            console.error('Failed to load directory tree:', err);
            const treeContainer = document.getElementById('directory-tree-tree');
            treeContainer.innerHTML = `<div class="empty-dir">Error: ${err.message}</div>`;
        }
    }
    
    renderDirectoryEntries(entries, currentPath) {
        if (!entries || entries.length === 0) {
            return '<div class="empty-dir">Empty directory</div>';
        }
        
        let html = '';
        entries.forEach(entry => {
            let fullPath;
            if (currentPath === '/') {
                fullPath = '/' + entry.name;
            } else {
                fullPath = currentPath + '/' + entry.name;
            }
            
            const isSelected = fullPath.includes(this.getCurrentCwd()) || fullPath === this.getCurrentCwd();
            const icon = entry.type === 'directory' ? '📁' : '📄';
            const iconSize = entry.type === 'directory' ? '1.2rem' : '1rem';
            const clickHandler = entry.type === 'directory' 
                ? `piClient.loadDirectoryTree('${fullPath}')` 
                : '';
            
            html += `
                <div class="tree-entry ${isSelected ? 'selected' : ''}" 
                     onclick="${clickHandler}" 
                     style="${clickHandler ? 'cursor: pointer;' : ''}">
                    <span class="file-icon" style="font-size: ${iconSize}">${icon}</span>
                    <strong class="file-name ${isSelected ? 'selected-file' : ''}">${entry.name}</strong>
                    ${entry.type === 'directory' ? '<span class="status">/</span>' : ''}
                </div>
            `;
        });
        
        return html;
    }
    
    browseUp() {
        const pathEl = document.getElementById('current-path');
        const path = pathEl.textContent;
        const index = path.lastIndexOf('/');
        
        if (index > 0) {
            const parentPath = path.substring(0, index);
            this.loadDirectoryTree(parentPath || '/');
        }
    }
    
    searchDirectory(query) {
        const treeEntries = document.querySelectorAll('.tree-entry');
        const searchTerm = query.toLowerCase();
        
        treeEntries.forEach(entry => {
            const name = entry.querySelector('.file-name')?.textContent.toLowerCase();
            if (name && name.includes(searchTerm)) {
                entry.style.display = '';
            } else if (query) {
                entry.style.display = 'none';
            }
        });
    }
    
    selectPath(path) {
        console.log('Selected path:', path);
        
        // Update the cwd select dropdown
        const select = document.getElementById('cwd-select');
        
        // Check if path matches a preset
        if (path === 'project') {
            select.value = 'project';
        } else if (path.substring(0, 2) === '~/' || path === '/Users/karim' || path === '/Users/karim/Projects') {
            select.value = path;
        } else {
            // Handle custom path
            select.value = 'custom';
            document.getElementById('custom-path-input').classList.add('active');
            document.getElementById('custom-path').value = path;
        }
    }
    
    confirmSelection() {
        const currentPathEl = document.getElementById('current-path');
        const selectedPath = currentPathEl.textContent || '';
        
        console.log('Confirming selection:', selectedPath);
        
        // Update the cwd select dropdown
        const select = document.getElementById('cwd-select');
        
        // Check if path is a preset
        const presets = {
            'project': 'Current project repo',
            '~/': 'Home directory (~)',
            '/Users/karim': 'Karim\'s home',
            '/Users/karim/Projects': 'Projects folder'
        };
        
        if (selectedPath === 'project') {
            select.value = 'project';
            foundPreset = true;
        } else if (presets[selectedPath]) {
            select.value = selectedPath;
            foundPreset = true;
            
            // Update custom path input
            if (selectedPath.substring(0, 2) === '~/' || selectedPath.startsWith('/Users')) {
                document.getElementById('custom-path-input').classList.remove('active');
            }
        } else {
            // Handle custom path
            select.value = 'custom';
            document.getElementById('custom-path-input').classList.add('active');
            document.getElementById('custom-path').value = selectedPath;
        }
        
        // Add to custom folders (except for presets)
        if (!presets[selectedPath] && selectedPath !== 'project') {
            this.addCustomFolder(selectedPath);
        }
        
        // Hide the directory browser
        const container = document.getElementById('directory-browser-container');
        container.style.display = 'none';
        this.directoryBrowserVisible = false;
        
        // Trigger load sessions if button exists
        const loadBtn = document.getElementById('load-sessions');
        if (loadBtn) {
            loadBtn.click();
        }
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
                
                // Defer model loading until socket is open
                this.loadModelsDeferred = true;
                
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
                    this.loadModelsDeferred = true;
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
            
            // Now load models since socket is ready
            if (this.loadModelsDeferred) {
                this.loadModels();
                this.loadModelsDeferred = null;
            }
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
    
    // Register a callback to load models once WebSocket is ready
    onModelLoad(callback) {
        this.modelLoadingCallbacks.push(callback);
    }
    
    // Send command via WebSocket
    sendRequest(command) {
        return new Promise((resolve, reject) => {
            const requestCallback = () => {
                // Remove old callback
                this.ws.removeEventListener('message', requestCallback);
                
                processMessage();
            };
            
            let received = false;
            function processMessage() {
                if (received) return;
                received = true;
                
                // Remove the listener
                this.ws.removeEventListener('message', requestCallback);
                
                setTimeout(() => {
                    // Resolve with the most recent request response
                    const messages = this.wsMessages.filter(msg => 
                        msg.type === 'response' && 
                        msg.command === command &&
                        (msg.id === request.id || !msg.id) // also accept anonymous responses
                    );
                    
                    if (messages.length > 0) {
                        resolve(messages[messages.length - 1]);
                    } else {
                        reject(new Error('No response received'));
                    }
                }, 100);
            }
            
            this.ws.addEventListener('message', requestCallback);
            
            // Queue the request
            this.wsRequests.push({
                id: 'req-' + Date.now(),
                type: command,
                data: null
            });
            
            // Send immediately
            this.ws.send(JSON.stringify({
                type: command,
                id: this.wsRequests[this.wsRequests.length - 1].id
            }));
        });
    }
    
    async loadModels() {
        const select = document.getElementById('model-select');
        select.innerHTML = '<option value="">Loading...</option>';
        
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.log('WebSocket not ready, showing error option');
            const option = document.createElement('option');
            option.disabled = true;
            option.textContent = 'Not connected';
            select.appendChild(option);
            return;
        }
        
        // Send get_available_models command via WebSocket
        const requestData = {
            type: 'get_available_models',
            id: 'load-models-' + Date.now()
        };
        
        console.log('Sending model request:', requestData);
        this.ws.send(JSON.stringify(requestData));
        
        // Wait for response (polling)
        const maxAttempts = 20;
        for (let i = 0; i < maxAttempts; i++) {
            // Check if we have model data from the response
            const response = this.getLatestResponse('get_available_models');
            if (response) {
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Get response
        const response = this.getLatestResponse('get_available_models') || {};
        const data = response.data || {};
        
        select.innerHTML = '';
        
        console.log('Model data:', JSON.stringify(data, null, 2));
        
        if (data.models && data.models.length > 0) {
            data.models.forEach(model => {
                const provider = model.provider || 'anthropic';
                const modelId = model.id || '';
                const name = model.name || `${provider} - ${modelId}`;
                const value = `${provider}/${modelId}`;
                
                const option = document.createElement('option');
                option.value = value;
                option.textContent = name;
                
                // If no current model is set, select the first one
                if (!this.selectedModel) {
                    this.selectedModel = modelId;
                    option.selected = true;
                }
                
                select.appendChild(option);
            });
            
            console.log(`Loaded ${data.models.length} models`);
        } else {
            const option = document.createElement('option');
            option.disabled = true;
            option.textContent = 'No models available';
            select.appendChild(option);
            console.warn('No models available from agent');
        }
    }
    
    // Get the most recent response for a command type
    getLatestResponse(command) {
        // Scan all WebSocket messages
        if (this.ws) {
            const messages = this.wsMessages || [];
            return messages
                .filter(m => m.type === 'response' && m.command === command)
                .pop();
        }
        return null;
    }
    
    selectModel() {
        const modelOption = document.getElementById('model-select').value;
        if (!modelOption) return;
        
        const [provider, model_id] = modelOption.split('/');
        this.selectedModel = model_id;
        
        // Disable dropdown during switch
        this.setSwitchingState(true);
        
        // Send set_model command
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'set_model',
                provider: provider || 'anthropic',
                modelId: model_id,
                id: 'set_model_' + Date.now()  // Unique ID for correlation
            }));
            
            // Register callback to wait for response
            this.modelSwitchCallback = (response) => {
                if (response.command === 'set_model') {
                    if (response.success) {
                        console.log('Model change confirmed');
                        this.setSwitchingState(false, '✓')
                    } else {
                        console.log('Model change failed');
                        this.setSwitchingState(false, '✗');
                    }
                }
            };
            
            // Set timeout if no response
            setTimeout(() => {
                if (this.setSwitchingStateTimeout) {
                    clearTimeout(this.setSwitchingStateTimeout);
                    this.setSwitchingState(false, '✗');
                }
            }, 5000);
        } else {
            this.setSwitchingState(false);
        }
    }
    
    setSwitchingState(disabled, status = null) {
        const select = document.getElementById('model-select');
        select.disabled = disabled;
        
        if (status === '✓') {
            // Success - show checkmark
            select.innerHTML = '<option selected>Model switched successfully ✓</option>';
        } else if (status === '✗') {
            // Failed
            select.innerHTML = '<option selected>Model switch failed ✗</option>';
        } else if (disabled) {
            // Loading state
            select.innerHTML = '<option selected>Switching... ⏳</option>';
        } else {
            // Reset to current model display
            const selectedOption = Array.from(select.options).find(opt => opt.selected);
            if (selectedOption) {
                select.innerHTML = '<option selected>' + selectedOption.textContent + '</option>';
            } else {
                const firstOption = select.options[0];
                select.innerHTML = '<option selected>' + (firstOption ? firstOption.textContent : 'Loading...') + '</option>';
            }
        }
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
        // Track streaming state - only true during active processing
        if (data.type === 'agent_start' && data.command !== 'get_available_models') {
            this.isStreaming = true;
            this.streamingStarted = false;
        }
        
        // Store messages for later retrieval
        if (!this.wsMessages) this.wsMessages = [];
        if (this.wsMessages.length > 100) {
            this.wsMessages = this.wsMessages.slice(-50);
        }
        this.wsMessages.push(data);
        
        if (data.type === 'response' && data.command === 'get_available_models') {
            console.log('Model response received:', data);
            this.selectedModel = data.data?.current?.id || data.data?.current?.model?.id || null;
            this.updateModelDropdown(data.data?.models || []);
        }
        
        if (data.type === 'response' && data.command === 'set_model') {
            console.log('set_model response received:', data);
            console.log('Checking modelSwitchCallback:', this.modelSwitchCallback ? 'EXISTS' : 'NOT EXISTS');
            this.isStreaming = false;
            
            // Call any registered callback
            if (this.modelSwitchCallback) {
                this.modelSwitchCallback(data);
                this.modelSwitchCallback = null;
            } else {
                // No callback waiting, still check state
                console.log('set_model completed - checking state for verification');
            }
        }
        
        if (data.type === 'response' && data.command === 'get_state') {
            if (data.success && data.data?.model) {
                console.log('Current model:', data.data.model.id, '(' + data.data.model.provider + ')');
            }
        }

        if (data.type === 'message_update' && data.assistantMessageEvent?.type === 'text_delta') {
            this.streamingStarted = true;
            this.addTyping(data.assistantMessageEvent.delta);
        }
        
        if (data.type === 'agent_end') {
            this.isStreaming = false;
            
            // Only create final message if we weren't streaming
            // (streaming already displayed the text via addTyping)
            if (!this.streamingStarted) {
                this.addMessage({
                    type: 'assistant',
                    content: this.extractTextFromMessages(data.messages),
                    timestamp: Date.now()
                });
            }
            
            this.streamingStarted = false;
        }
    }
    
    updateModelDropdown(models) {
        const select = document.getElementById('model-select');
        select.innerHTML = '';
        
        // Track which model should be selected
        let selectedFound = false;
        
        models.forEach(model => {
            const provider = model.provider || 'anthropic';
            const modelId = model.id || '';
            const name = model.name || `${provider} - ${modelId}`;
            
            // Add provider label in brackets for visibility
            const displayName = `${name} [${provider}]`;
            const value = `${provider}/${modelId}`;
            
            const option = document.createElement('option');
            option.value = value;
            option.textContent = displayName;
            
            // Auto-select if no model selected yet
            if (!this.selectedModel && !selectedFound) {
                this.selectedModel = modelId;
                option.selected = true;
                selectedFound = true;
            }
            
            select.appendChild(option);
        });
        
        console.log(`Loaded ${models.length} models to dropdown`);
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
            const promptData = {
                type: 'prompt',
                message: message,
                id: 'req-' + Date.now()
            };
            
            // Only include streamingBehavior if agent is currently streaming
            if (this.isStreaming) {
                promptData.streamingBehavior = 'steer';
            }
            
            this.ws.send(JSON.stringify(promptData));
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
    
    // Custom folder management
    loadCustomFolders() {
        try {
            const data = localStorage.getItem('custom_folders');
            this.customFolders = data ? JSON.parse(data) : [];
        } catch (e) {
            this.customFolders = [];
        }
        this.renderCustomFolders();
    }
    
    addCustomFolder(path) {
        this.customFolders = this.customFolders || [];
        
        // Remove if already exists
        const index = this.customFolders.indexOf(path);
        if (index !== -1) {
            this.customFolders.splice(index, 1);
        }
        
        // Limit to 10 custom folders
        if (this.customFolders.length >= 10) {
            this.customFolders.pop();
        }
        
        this.customFolders.unshift(path);
        try {
            localStorage.setItem('custom_folders', JSON.stringify(this.customFolders));
        } catch (e) {
            console.warn('Could not save custom folders:', e);
        }
        this.renderCustomFolders();
    }
    
    renderCustomFolders() {
        const container = document.getElementById('custom-folders-container');
        const listContainer = document.getElementById('custom-folders-list');
        
        if (!this.customFolders || this.customFolders.length === 0) {
            listContainer.style.display = 'none';
            return;
        }
        
        listContainer.style.display = 'block';
        container.innerHTML = this.customFolders.map(folder => {
            const shortName = this.shortenPath(folder);
            return `
                <div class="custom-folder-option" onclick="piClient.selectCustomFolder('${folder}')">
                    <span class="folder-tree-icon">📁</span>
                    <span style="font-size: 0.85rem;">${shortName}</span>
                    <button 
                        onclick="event.stopPropagation(); piClient.removeCustomFolder('${folder}')" 
                        style="margin-left: auto; background: #444; border: none; border-radius: 3px; padding: 0.25rem; cursor: pointer;"
                        title="Remove this folder"
                    >✕</button>
                </div>
            `;
        }).join('');
    }
    
    selectCustomFolder(path) {
        const select = document.getElementById('cwd-select');
        select.value = path;
        
        if (path === 'project') {
            select.value = 'project';
        } else if (path.substring(0, 2) === '~/' || path === '/Users/karim' || path === '/Users/karim/Projects') {
            select.value = path;
            document.getElementById('custom-path-input').classList.remove('active');
        } else {
            select.value = 'custom';
            document.getElementById('custom-path-input').classList.add('active');
            document.getElementById('custom-path').value = path;
        }
        
        document.getElementById('custom-folders-list').style.display = 'none';
    }
    
    removeCustomFolder(path) {
        this.customFolders = this.customFolders.filter(p => p !== path);
        try {
            localStorage.setItem('custom_folders', JSON.stringify(this.customFolders));
        } catch (e) {
            console.warn('Could not save custom folders:', e);
        }
        this.renderCustomFolders();
        
        if (!this.customFolders || this.customFolders.length === 0) {
            document.getElementById('custom-folders-list').style.display = 'none';
        }
    }
    
    async init() {
        await this.loadInitialDirectory();
        this.loadCustomFolders();
        this.bindEvents();
    }
}

function toggleCustomPath() { window.piClient.toggleCustomPath(); }
function loadSessionsAvailable() { window.piClient.loadSessionsAvailable(); }
function startSession() { window.piClient.startSession(); }
function selectModel() { window.piClient.selectModel(); }
function refreshModels() { window.piClient.refreshModels(); }

document.addEventListener('DOMContentLoaded', () => {
    window.piClient = new PiClient();
});
