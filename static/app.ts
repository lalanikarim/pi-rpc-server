// @ts-check
/** Pi RPC Server Frontend Client */

/** @typedef {Object} PiClient */

/**
 * PiClient class
 * @class
 */
class PiClient {
    /** @type {string} */
    baseUrl;
    /** @type {string|null} */
    sessionId;
    /** @type {WebSocket|null} */
    ws;
    /** @type {Array<Object>} */
    messageHistory;
    /** @type {string|null} */
    selectedCwd;
    /** @type {Array<Function>} */
    modelLoadingCallbacks;
    /** @type {boolean|null} */
    loadModelsDeferred;
    /** @type {boolean} */
    isStreaming;
    /** @type {boolean} */
    streamingStarted;
    /** @type {boolean} */
    directoryBrowserVisible;
    /** @type {Array<string>|undefined} */
    customFolders;

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
        this.customFolders = undefined;
        this.init();
    }
}

/** @typedef {PiClient} PiClientType */
