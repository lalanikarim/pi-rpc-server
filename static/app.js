/**
 * Pi RPC Server - Frontend Client Type-Safe JavaScript
 * This file is compiled from TypeScript - @ts-check enabled in IDEs
 */

/**
 * PiClient - Main client class
 * @class
 */
class PiClient {
    /** @type {string} */
    baseUrl;
    /** @type {string|null} */
    sessionId = null;
    /** @type {WebSocket|null} */
    ws = null;
    /** @type {Array<Object>} */
    messageHistory = [];
    /** @type {string|null} */
    selectedCwd = null;
    /** @type {Array<Function>} */
    modelLoadingCallbacks = [];
    /** @type {boolean|null} */
    loadModelsDeferred = null;
    /** @type {boolean} */
    isStreaming = false;
    /** @type {boolean} */
    streamingStarted = false;
    /** @type {boolean} */
    directoryBrowserVisible = false;
    /** @type {Array<string>|undefined} */
    customFolders;

    constructor() {
        this.baseUrl = window.location.origin;
        this.init();
    }

    /** @returns {void} */
    init() {
        this.loadCustomFolders();
        this.bindEvents();
    }

    /** @returns {void} */
    loadCustomFolders() {
        try {
            const data = localStorage.getItem('custom_folders');
            this.customFolders = data ? JSON.parse(data) : [];
        } catch (e) {
            console.error('Failed to load custom folders:', e);
            this.customFolders = [];
        }
        this.renderCustomFolders();
    }

    /**
     * @param {string} path - Folder path to add
     * @returns {void}
     */
    addCustomFolder(path) {
        if (!this.customFolders) {
            this.customFolders = [];
        }
        const index = this.customFolders.indexOf(path);
        if (index !== -1) {
            this.customFolders.splice(index, 1);
        }
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

    /** @returns {void} */
    renderCustomFolders() {
        const container = document.getElementById('custom-folders-container');
        const listContainer = document.getElementById('custom-folders-list');
        if (!listContainer) return;
        if (!this.customFolders || this.customFolders.length === 0) {
            listContainer.style.display = 'none';
            return;
        }
        listContainer.style.display = 'block';
        listContainer.innerHTML = this.customFolders
            .map(folder => {
                const shortName = this.shortenPath(folder);
                const escaped = folder.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                return `
                    <div class="custom-folder-option" onclick="piClient.selectCustomFolder('${escaped}')">
                        <span class="folder-tree-icon">📁</span>
                        <span style="font-size: 0.85rem;">${shortName}</span>
                        <button onclick="event.stopPropagation(); piClient.removeCustomFolder('${escaped}')"
                            style="margin-left: auto; background: #444; border: none; border-radius: 3px; padding: 0.25rem;">✕</button>
                    </div>`;
            }).join('');
    }

    /**
     * @param {string} path - Folder path
     * @returns {void}
     */
    selectCustomFolder(path) {
        const select = /** @type {HTMLSelectElement|null} */ (document.getElementById('cwd-select'));
        if (!select) return;
        select.value = path === 'project' ? 'project' : 
                      path.startsWith('~/') || path === '/Users/karim' || path === '/Users/karim/Projects' ? path : 'custom';
        const list = document.getElementById('custom-folders-list');
        if (list) list.style.display = 'none';
    }

    /**
     * @param {string} path - Folder path to remove
     * @returns {void}
     */
    removeCustomFolder(path) {
        if (!this.customFolders) return;
        this.customFolders = this.customFolders.filter(p => p !== path);
        try {
            localStorage.setItem('custom_folders', JSON.stringify(this.customFolders));
        } catch (e) {
            console.warn('Could not save custom folders:', e);
        }
        this.renderCustomFolders();
        const list = document.getElementById('custom-folders-list');
        if (!this.customFolders || this.customFolders.length === 0 || !list) {
            if (list) list.style.display = 'none';
        }
    }

    /**
     * @param {string} path - Path to shorten
     * @returns {string} Shortened path
     */
    shortenPath(path) {
        if (!path) return '';
        const parts = path.split('/');
        return parts.length > 3 ? `.../${parts.slice(-2).join('/')}` : path;
    }

    /** @returns {void} */
    bindEvents() {
        const input = /** @type {HTMLTextAreaElement|null} */ (document.getElementById('prompt-input'));
        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendPrompt();
                }
            });
        }
    }

    toggleCustomPath() {
        console.log('Custom path input not available');
    }

    /**
     * @returns {string} Current working directory
     */
    getCurrentCwd() {
        const select = /** @type {HTMLSelectElement|null} */ (document.getElementById('cwd-select'));
        if (!select) return '';
        return select.value === 'custom' ? select.value : select.value;
    }

    /**
     * @param {string} path - Path to select
     * @returns {void}
     */
    selectPath(path) {
        const select = /** @type {HTMLSelectElement|null} */ (document.getElementById('cwd-select'));
        if (!select) return;
        select.value = path === 'project' ? 'project' :
                      path.startsWith('~/') || path === '/Users/karim' || path === '/Users/karim/Projects' ? path : 'custom';
    }

    /** @returns {void} */
    confirmSelection() {
        const pathEl = /** @type {HTMLElement|null} */ (document.getElementById('current-path'));
        const selectedPath = pathEl?.textContent || '';
        console.log('Confirming selection:', selectedPath);
        const select = /** @type {HTMLSelectElement|null} */ (document.getElementById('cwd-select'));
        if (!select) return;
        const presets = {'project': 'repo', '~/': '~', '/Users/karim': 'home', '/Users/karim/Projects': 'projects'};
        select.value = presets[selectedPath] || 'custom';
        if (!presets[selectedPath] && selectedPath !== 'project') {
            this.addCustomFolder(selectedPath);
        }
        const container = /** @type {HTMLDivElement|null} */ (document.getElementById('directory-browser-container'));
        if (container) container.style.display = 'none';
        this.directoryBrowserVisible = false;
        const btn = /** @type {HTMLButtonElement|null} */ (document.getElementById('load-sessions'));
        if (btn) btn.click();
    }
}

window.piClient = /** @type {PiClient|null} */ (null);
