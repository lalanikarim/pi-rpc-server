/**
 * Pi RPC Server - Frontend TypeScript Client
 * Type-safe JavaScript for better IDE support and error catching
 */

// Global type declarations for window object extensions
declare global {
    interface Window {
        homeDir?: string;
        piClient: PiClient;
    }
}

// Type definitions for API responses
interface DirectoryEntry {
    name: string;
    type: 'directory' | 'file';
}

interface BrowseResponse {
    path: string;
    entries: DirectoryEntry[];
    parent?: string;
    error?: string;
}

interface ModelData {
    provider: string;
    id: string;
    name?: string;
    [key: string]: any;
}

interface CurrentModelData {
    id?: string;
    model?: {
        id: string;
    };
}

// Type guards for null safety
function isElement<T extends Element>(element: Element | null): element is T {
    return element !== null;
}

/**
 * PiClient - Frontend client for Pi RPC Server
 */
class PiClient {
    // Constructor properties with explicit types
    baseUrl: string = window.location.origin;
    sessionId: string | null = null;
    ws: WebSocket | null = null;
    messageHistory: any[] = [];
    selectedCwd: string | null = null;
    modelLoadingCallbacks: Array<() => void> = [];
    loadModelsDeferred: boolean | null = null;
    isStreaming: boolean = false;
    streamingStarted: boolean = false;
    directoryBrowserVisible: boolean = false;
    customFolders?: string[] = [];

    constructor() {
        this.baseUrl = window.location.origin;
        this.sessionId = null;
        this.ws = null;
        this.messageHistory = [];
        this.selectedCwd = null;
        this.modelLoadingCallbacks = [];
        this.loadModelsDeferred = null;
        this.isStreaming = false;
        this.streamingStarted = false;
        this.directoryBrowserVisible = false;
        this.init();
    }

    // Custom folder management
    loadCustomFolders(): void {
        try {
            const data = localStorage.getItem('custom_folders');
            this.customFolders = data ? JSON.parse(data) : [];
        } catch (e) {
            console.error('Failed to load custom folders:', e);
            this.customFolders = [];
        }
        this.renderCustomFolders();
    }

    addCustomFolder(path: string): void {
        if (!this.customFolders) {
            this.customFolders = [];
        }

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

    renderCustomFolders(): void {
        const container = document.getElementById('custom-folders-container');
        const listContainer = document.getElementById('custom-folders-list');

        if (!listContainer) return;
        
        if (!this.customFolders || this.customFolders.length === 0) {
            listContainer.style.display = 'none';
            return;
        }

        listContainer.style.display = 'block';
        listContainer.innerHTML = this.customFolders.map(folder => {
            const shortName = this.shortenPath(folder);
            return `
                <div class="custom-folder-option" onclick="piClient.selectCustomFolder('${this.escapeForHtml(folder)}')">
                    <span class="folder-tree-icon">📁</span>
                    <span style="font-size: 0.85rem;">${shortName}</span>
                    <button 
                        onclick="event.stopPropagation(); piClient.removeCustomFolder('${this.escapeForHtml(folder)}')" 
                        style="margin-left: auto; background: #444; border: none; border-radius: 3px; padding: 0.25rem; cursor: pointer;"
                        title="Remove this folder"
                    >✕</button>
                </div>
            `;
        }).join('');
    }

    selectCustomFolder(path: string): void {
        const select = document.getElementById('cwd-select');
        if (!select) return;
        
        if (path === 'project') {
            select.value = 'project';
        } else if (path.substring(0, 2) === '~/' || path === '/Users/karim' || path === '/Users/karim/Projects') {
            select.value = path;
        } else {
            select.value = 'custom';
        }

        const customFoldersList = document.getElementById('custom-folders-list');
        if (customFoldersList) {
            customFoldersList.style.display = 'none';
        }
    }

    removeCustomFolder(path: string): void {
        if (!this.customFolders) return;
        
        this.customFolders = this.customFolders.filter(p => p !== path);
        try {
            localStorage.setItem('custom_folders', JSON.stringify(this.customFolders));
        } catch (e) {
            console.warn('Could not save custom folders:', e);
        }
        this.renderCustomFolders();

        if (!this.customFolders || this.customFolders.length === 0) {
            const list = document.getElementById('custom-folders-list');
            if (list) {
                list.style.display = 'none';
            }
        }
    }

    // Directory browser methods
    init(): void {
        this.loadCustomFolders();
        this.bindEvents();
    }

    escapeForHtml(text: string): string {
        return text.replace(/'/g, "\\'").replace(/"/g, '&quot;');
    }

    shortenPath(path: string): string {
        if (!path) return '';
        const parts = path.split('/');
        if (parts.length > 3) {
            return `.../${parts.slice(-2).join('/')}`;
        }
        return path;
    }

    async loadInitialDirectory(): Promise<void> {
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

    toggleDirectoryBrowser(): void {
        const container = document.getElementById('directory-browser-container');
        if (!container) return;
        
        this.directoryBrowserVisible = !this.directoryBrowserVisible;
        container.style.display = this.directoryBrowserVisible ? 'block' : 'none';

        if (this.directoryBrowserVisible) {
            this.loadDirectoryTree(window.homeDir || '/Users/karim');
        }
    }

    async loadDirectoryTree(path: string): Promise<void> {
        try {
            const response = await fetch(`${this.baseUrl}/api/browse?path=${encodeURIComponent(path)}`);
            const data = await response.json() as BrowseResponse;

            if (!data || !data.entries) {
                throw new Error('Failed to load directory');
            }

            const treeContainer = document.getElementById('directory-tree-tree');
            if (treeContainer) {
                treeContainer.innerHTML = this.renderDirectoryEntries(data.entries, path);
            }

            const pathEl = document.getElementById('current-path');
            if (pathEl) {
                pathEl.textContent = path;
            }

        } catch (err) {
            console.error('Failed to load directory tree:', err);
            const treeContainer = document.getElementById('directory-tree-tree');
            if (treeContainer) {
                treeContainer.innerHTML = `<div class="empty-dir">Error: ${err.message}</div>`;
            }
        }
    }

    renderDirectoryEntries(entries: DirectoryEntry[], currentPath: string): string {
        if (!entries || entries.length === 0) {
            return '<div class="empty-dir">Empty directory</div>';
        }
        
        const customCwd = this.getCurrentCwd();
        
        return entries.map(entry => {
            let fullPath: string;
            if (currentPath === '/') {
                fullPath = '/' + entry.name;
            } else {
                fullPath = currentPath + '/' + entry.name;
            }
            
            const isSelected = fullPath.includes(customCwd) || fullPath === customCwd;
            const icon = entry.type === 'directory' ? '📁' : '📄';
            const iconSize = entry.type === 'directory' ? '1.2rem' : '1rem';
            
            return `
                <div class="tree-entry ${isSelected ? 'selected' : ''}">
                    <span class="file-icon" style="font-size: ${iconSize}">${icon}</span>
                    <strong class="file-name ${isSelected ? 'selected-file' : ''}">${entry.name}</strong>
                    ${entry.type === 'directory' ? '<span class="status">/</span>' : ''}
                </div>
            `;
        }).join('');
    }

    browseUp(): void {
        const pathEl = document.getElementById('current-path');
        if (!pathEl) return;
        
        const path = pathEl.textContent;
        if (!path) return;
        
        const index = path.lastIndexOf('/');
        
        if (index > 0) {
            const parentPath = path.substring(0, index);
            this.loadDirectoryTree(parentPath || '/');
        }
    }

    searchDirectory(query: string): void {
        const treeEntries = document.querySelectorAll('.tree-entry');
        const searchTerm = query.toLowerCase();
        
        treeEntries.forEach(entry => {
            const nameEl = entry.querySelector('.file-name');
            const name = nameEl?.textContent;
            
            if (name && name.includes(searchTerm)) {
                (entry as HTMLElement).style.display = '';
            } else if (query) {
                (entry as HTMLElement).style.display = 'none';
            }
        });
    }

    // CWD selection logic
    toggleCustomPath(): void {
        // Custom path field doesn't exist, nothing to show/hide
        console.log('Custom path input not available');
    }

    getCurrentCwd(): string {
        const select = document.getElementById('cwd-select');
        if (!select) return '';
        
        // All custom folders go to 'custom' value, no custom-path field exists
        if (select.value === 'custom') {
            // Return a placeholder - custom path input doesn't exist
            return select.value || '';
        }
        return select.value;
    }

    selectPath(path: string): void {
        const select = document.getElementById('cwd-select');
        if (!select) return;
        
        if (path === 'project') {
            select.value = 'project';
        } else if (path.substring(0, 2) === '~/' || path === '/Users/karim' || path === '/Users/karim/Projects') {
            select.value = path;
        } else {
            select.value = 'custom';
        }
    }

    confirmSelection(): void {
        const currentPathEl = document.getElementById('current-path');
        if (!currentPathEl) {
            console.error('Current path element not found');
            return;
        }
        
        const selectedPath = currentPathEl.textContent || '';
        
        console.log('Confirming selection:', selectedPath);
        
        const select = document.getElementById('cwd-select');
        if (!select) {
            console.error('CWD select element not found');
            return;
        }
        
        const presets: Record<string, string> = {
            'project': 'Current project repo',
            '~/': 'Home directory (~)',
            '/Users/karim': "Karim's home",
            '/Users/karim/Projects': 'Projects folder'
        };
        
        if (selectedPath === 'project') {
            select.value = 'project';
        } else if (presets[selectedPath]) {
            select.value = selectedPath;
        } else {
            select.value = 'custom';
        }
        
        if (!presets[selectedPath] && selectedPath !== 'project') {
            this.addCustomFolder(selectedPath);
        }
        
        const container = document.getElementById('directory-browser-container');
        if (container) {
            container.style.display = 'none';
        }
        
        this.directoryBrowserVisible = false;
        
        // Trigger load sessions if button exists
        const loadBtn = document.getElementById('load-sessions');
        if (loadBtn) {
            loadBtn.click();
        }
    }

    bindEvents(): void {
        const promptInput = document.getElementById('prompt-input');
        if (promptInput) {
            promptInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendPrompt();
                }
            });
        }
    }

    async startSession(): Promise<void> {
        const cwd = this.getCurrentCwd();
        if (!cwd) {
            alert('Please select a working directory.');
            return;
        }
        
        const agentSelect = document.getElementById('agent-select');
        if (!agentSelect) return;
        
        const agentValue = agentSelect.value;
        
        if (agentValue && agentValue !== 'new') {
            try {
                const agentInfo = JSON.parse(agentValue);
                this.sessionId = agentInfo.id;
                const setupPanel = document.getElementById('setup-panel');
                const sessionUi = document.getElementById('session-ui');
                
                if (setupPanel && sessionUi) {
                    setupPanel.style.display = 'none';
                    sessionUi.classList.add('active');
                }
                
                await this.initWebSocket();
                this.loadModelsDeferred = true;
            } catch (e) {
                console.error('Failed to parse agent selection:', e);
            }
        } else {
            const btn = document.querySelector('#available-sessions button');
            if (btn) {
                const createBtn = btn as HTMLElement;
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
                        const setupPanel = document.getElementById('setup-panel');
                        const sessionUi = document.getElementById('session-ui');
                        
                        if (setupPanel && sessionUi) {
                            setupPanel.style.display = 'none';
                            sessionUi.classList.add('active');
                        }
                        
                        await this.initWebSocket();
                        this.loadModelsDeferred = true;
                    }
                } catch (err) {
                    console.error('Failed to create session:', err);
                    alert('Failed to create session: ' + err.message);
                    if (btn) {
                        (btn as HTMLElement).textContent = 'Start Session';
                        btn.disabled = false;
                    }
                }
            }
        }
    }

    async initWebSocket(): Promise<void> {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${this.baseUrl.split('://')[1]}/ws/${this.sessionId}`;
        
        this.ws = new WebSocket(wsUrl);
        this.ws.onopen = () => {
            this.updateConnectionBadge('connected');
            console.log('WebSocket connected');
            
            if (this.loadModelsDeferred) {
                this.loadModels();
                this.loadModelsDeferred = null;
            }
        };
        
        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleWebSocketMessage(data);
            } catch (e) {
                console.error('Failed to parse message:', e, event.data);
            }
        };
        
        this.ws.onclose = () => {
            this.updateConnectionBadge('disconnected');
        };
        
        this.ws.onerror = (err) => {
            console.error('WebSocket error:', err);
        };
    }

    async loadModels(): Promise<void> {
        const select = document.getElementById('model-select');
        if (!select) return;
        
        select.innerHTML = '<option value="">Loading models...</option>';
        
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.log('WebSocket not ready, showing not connected option');
            const option = document.createElement('option');
            option.disabled = true;
            option.textContent = 'Not connected';
            select.appendChild(option);
            return;
        }
        
        const requestData = {
            type: 'get_available_models',
            id: 'load-models-' + Date.now()
        };
        
        console.log('Sending model request:', requestData);
        this.ws.send(JSON.stringify(requestData));
    }

    async sendPrompt(): Promise<void> {
        const input = document.getElementById('prompt-input') as HTMLTextAreaElement;
        if (!input) return;
        
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
            const promptData: any = {
                type: 'prompt',
                message: message,
                id: 'req-' + Date.now()
            };
            
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
                if (input) {
                    input.disabled = false;
                }
            }
        }, 1000);
    }

    handleWebSocketMessage(data: any): void {
        if (data.type === 'agent_start' && data.command !== 'get_available_models') {
            this.isStreaming = true;
            this.streamingStarted = false;
        }
        
        // Store messages for later retrieval
        if (!this.wsMessages) {
            this.wsMessages = [];
        }
        if (this.wsMessages.length > 100) {
            this.wsMessages = this.wsMessages.slice(-50);
        }
        this.wsMessages.push(data);
        
        if (data.type === 'response' && data.command === 'get_available_models') {
            console.log('Model response received:', data);
            const currentData = data.data || {};
            this.selectedModel = currentData.id || (currentData.model?.id || null);
            if (currentData.models) {
                this.updateModelDropdown(currentData.models);
            }
        }
        
        if (data.type === 'response' && data.command === 'set_model') {
            console.log('set_model response received:', data);
            this.isStreaming = false;
            
            if (this.modelSwitchCallback) {
                this.modelSwitchCallback(data);
                this.modelSwitchCallback = null;
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

    updateModelDropdown(models: ModelData[]): void {
        const select = document.getElementById('model-select');
        if (!select) return;
        
        select.innerHTML = '';
        
        if (!models || models.length === 0) {
            const option = document.createElement('option');
            option.disabled = true;
            option.textContent = 'No models available';
            select.appendChild(option);
            return;
        }
        
        let selectedFound = false;
        
        models.forEach(model => {
            const provider = model.provider || 'anthropic';
            const modelId = model.id || '';
            const name = model.name || `${provider} - ${modelId}`;
            const displayName = `${name} [${provider}]`;
            const value = `${provider}/${modelId}`;
            
            const option = document.createElement('option');
            option.value = value;
            option.textContent = displayName;
            
            if (!this.selectedModel && !selectedFound) {
                this.selectedModel = modelId;
                option.selected = true;
                selectedFound = true;
            }
            
            select.appendChild(option);
        });
        
        console.log(`Loaded ${models.length} models to dropdown`);
    }

    selectModel(): void {
        const select = document.getElementById('model-select');
        if (!select) return;
        
        const modelOption = select.value;
        if (!modelOption) return;
        
        const parts = modelOption.split('/');
        const provider = parts[0];
        const model_id = parts.slice(1).join('/');
        
        this.selectedModel = model_id;
        
        if (!this.ws) return;
        if (this.ws.readyState !== WebSocket.OPEN) return;
        
        const ws = this.ws;
        ws.send(JSON.stringify({
            type: 'set_model',
            provider: provider || 'anthropic',
            modelId: model_id,
            id: 'set_model_' + Date.now()
        }));
        
        // Register callback
        this.modelSwitchCallback = (response: any) => {
            if (response.command === 'set_model') {
                if (response.success) {
                    console.log('Model change confirmed');
                } else {
                    console.log('Model change failed');
                }
            }
        };
    }

    async refreshModels(): Promise<void> {
        await this.loadModels();
    }

    updateConnectionBadge(status: string): void {
        const badge = document.getElementById('connection-badge');
        if (!badge) return;
        
        if (status === 'connected') {
            badge.className = 'badge connected';
            badge.textContent = 'Connected';
        } else {
            badge.className = 'badge disconnected';
            badge.textContent = 'Disconnected';
        }
    }

    extractTextFromMessages(messages: any[]): string {
        let text = '';
        messages?.forEach(msg => {
            if (msg.role === 'assistant') {
                const texts = msg.content?.filter(c => c.type === 'text').map(c => c.text) || [];
                text += texts.join('');
            }
        });
        return text;
    }

    addMessage(msg: { type: string; content: string; timestamp: number }): void {
        const el = document.createElement('div');
        el.className = `message ${msg.type}`;
        el.innerHTML = `
            <div class="message-timestamp">${new Date(msg.timestamp).toLocaleTimeString()}</div>
            <div class="message-content">${this.escapeHtml(msg.content)}</div>
        `;
        
        const history = document.getElementById('message-history');
        if (history) {
            history.appendChild(el);
            this.scrollToBottom();
        }
    }

    addTyping(text: string): void {
        const messages = document.querySelectorAll('.message.assistant');
        const lastMsg = messages[messages.length - 1] as HTMLElement;
        
        if (!lastMsg) {
            const el = document.createElement('div');
            el.className = 'message assistant';
            el.innerHTML = '<div class="message-timestamp"></div><div class="message-content"></div>';
            
            const history = document.getElementById('message-history');
            if (history) {
                history.appendChild(el);
            }
            return;
        }
        
        const timestampEl = lastMsg.querySelector('.message-timestamp');
        const contentEl = lastMsg.querySelector('.message-content');
        
        if (timestampEl) {
            timestampEl.textContent = new Date().toLocaleTimeString();
        }
        if (contentEl) {
            contentEl.textContent += text;
        }
        
        this.scrollToBottom();
    }

    scrollToBottom(): void {
        const history = document.getElementById('message-history');
        if (history) {
            history.scrollTop = history.scrollHeight;
        }
    }

    escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    wsMessages: any[] = [];
    modelSwitchCallback?: (response: any) => void;
    selectedModel?: string;
}

// Global function declarations for HTML inline handlers
declare function toggleCustomPath(): void;
declare function loadSessionsAvailable(): void;
declare function startSession(): void;
declare function selectModel(): void;
declare function refreshModels(): void;

function toggleCustomPath(): void { 
    if (window.piClient) {
        window.piClient.toggleCustomPath();
    }
}

function loadSessionsAvailable(): void { 
    if (window.piClient) {
        window.piClient.loadSessionsAvailable();
    }
}

function startSession(): void { 
    if (window.piClient) {
        window.piClient.startSession();
    }
}

function selectModel(): void { 
    if (window.piClient) {
        window.piClient.selectModel();
    }
}

function refreshModels(): void { 
    if (window.piClient) {
        window.piClient.refreshModels();
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.piClient = new PiClient();
});
