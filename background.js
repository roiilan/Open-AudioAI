// Background Service Worker for Open AudioAi Chrome Extension
// Security: Handles authentication, API communication, and extension lifecycle

// Extension lifecycle management
chrome.runtime.onInstalled.addListener((details) => {
    console.log('Open AudioAi extension installed/updated:', details.reason);
    
    // Initialize extension settings
    if (details.reason === 'install') {
        // Set default settings on first install
        chrome.storage.local.set({
            extensionVersion: chrome.runtime.getManifest().version,
            installDate: Date.now(),
            securitySettings: {
                enableSecurityLogging: true,
                validateApiRequests: true,
                enforceHttpsOnly: true
            }
        });
        
        // Open welcome page or setup instructions
        chrome.tabs.create({
            url: 'https://chat.openai.com',
            active: true
        });
    }
});

// Security monitoring and request validation
const SecurityManager = {
    // Track suspicious activities
    suspiciousActivities: new Map(),
    
    // Validate API requests
    validateRequest(request, sender) {
        // Check if request comes from authorized extension context
        if (!sender.id || sender.id !== chrome.runtime.id) {
            this.logSecurity('unauthorized_sender', { sender });
            return false;
        }
        
        // Validate request structure
        if (!request || typeof request !== 'object') {
            this.logSecurity('invalid_request_structure', { request });
            return false;
        }
        
        return true;
    },
    
    // Log security events
    logSecurity(event, data = {}) {
        const logEntry = {
            timestamp: Date.now(),
            event,
            data,
            extensionVersion: chrome.runtime.getManifest().version
        };
        
        console.warn('Security Event:', logEntry);
        
        // In production, you might want to send this to your security monitoring service
        // this.reportSecurityEvent(logEntry);
    },
    
    // Rate limiting for API requests
    checkRateLimit(userId) {
        const now = Date.now();
        const windowMs = 60000; // 1 minute
        const maxRequests = 10; // Max 10 requests per minute
        
        if (!this.rateLimitData) {
            this.rateLimitData = new Map();
        }
        
        const userRequests = this.rateLimitData.get(userId) || [];
        const recentRequests = userRequests.filter(time => now - time < windowMs);
        
        if (recentRequests.length >= maxRequests) {
            this.logSecurity('rate_limit_exceeded', { userId, requestCount: recentRequests.length });
            return false;
        }
        
        recentRequests.push(now);
        this.rateLimitData.set(userId, recentRequests);
        
        return true;
    }
};

// Authentication management
const AuthManager = {
    async validateToken(token) {
        if (!token || typeof token !== 'string') {
            return false;
        }
        
        try {
            // Verify token with Google (modern endpoint)
            const response = await fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + token);
            const tokenInfo = await response.json();
            
            if (tokenInfo.error) {
                SecurityManager.logSecurity('invalid_token', { error: tokenInfo.error });
                return false;
            }
            
            // Check token expiration if present
            const expiresIn = parseInt(tokenInfo.expires_in);
            if (!Number.isNaN(expiresIn) && expiresIn < 300) { // Less than 5 minutes
                SecurityManager.logSecurity('token_expiring_soon', { expiresIn });
                return false;
            }
            
            return true;
        } catch (error) {
            SecurityManager.logSecurity('token_validation_error', { error: error.message });
            return false;
        }
    },
    
    async refreshTokenIfNeeded(userData) {
        if (!userData || !userData.accessToken) {
            return null;
        }
        
        const isValid = await this.validateToken(userData.accessToken);
        if (isValid) {
            return userData;
        }
        
        try {
            // Attempt to get a new token
            const newToken = await new Promise((resolve, reject) => {
                chrome.identity.getAuthToken({ interactive: false }, (token) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(token);
                    }
                });
            });
            
            // Update stored user data
            const updatedUserData = { ...userData, accessToken: newToken };
            await chrome.storage.local.set({ userData: updatedUserData });
            
            return updatedUserData;
        } catch (error) {
            SecurityManager.logSecurity('token_refresh_failed', { error: error.message });
            return null;
        }
    }
};

// Add upload/transcription handling in background service worker
const UploadManager = (() => {
    const SERVER_BASE_URL = 'http://localhost:8000';

    function toNumberSafe(value) {
        if (typeof value === 'number') return value;
        if (typeof value === 'string') {
            const trimmed = value.trim();
            const num = Number(trimmed);
            if (!Number.isNaN(num)) return num;
        }
        return null;
    }

    function normalizeTranscriptionResponse(raw) {
        let words = [];
        let transcript = '';

        if (Array.isArray(raw)) {
            words = raw;
        } else if (raw && typeof raw === 'object') {
            if (Array.isArray(raw.words)) words = raw.words;
            if (typeof raw.transcript === 'string') transcript = raw.transcript;
        }

        // Coerce start/end into numbers and ensure word text
        words = (words || []).map((w) => {
            const startNum = toNumberSafe(w?.start);
            const endNum = toNumberSafe(w?.end);
            return {
                word: typeof w?.word === 'string' ? w.word : String(w?.word ?? ''),
                start: typeof startNum === 'number' ? startNum : null,
                end: typeof endNum === 'number' ? endNum : null,
            };
        });

        if (!transcript && words.length) {
            // Many servers include leading spaces in word tokens; joining without separator preserves spacing
            transcript = words.map(w => w.word || '').join('').replace(/\s+/g, ' ').trim();
        }

        return { success: true, transcript: transcript || '', words };
    }

    function parseTranscriptionResponseText(text) {
        // First try strict JSON
        try {
            const obj = JSON.parse(text);
            return normalizeTranscriptionResponse(obj);
        } catch (_) {}

        // Attempt to sanitize Python-like repr into JSON
        let cleaned = String(text || '').trim();
        // Replace np.float64(1.23) -> 1.23
        cleaned = cleaned.replace(/np\.float64\(\s*([^)]+?)\s*\)/g, '$1');
        // Replace Python booleans and None
        cleaned = cleaned.replace(/\bNone\b/g, 'null').replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false');
        // Quote keys: 'key': -> "key":
        cleaned = cleaned.replace(/'([^'\n\r]+)'\s*:/g, '"$1":');
        // Quote string values: : 'value' -> : "value"
        cleaned = cleaned.replace(/:\s*'([^']*)'/g, ': "$1"');

        try {
            const obj2 = JSON.parse(cleaned);
            return normalizeTranscriptionResponse(obj2);
        } catch (e) {
            throw new Error('Unable to parse server response');
        }
    }

    async function saveTranscriptRecord(record) {
        try {
            const { transcripts = [] } = await chrome.storage.local.get(['transcripts']);
            const updated = [record, ...transcripts];
            await chrome.storage.local.set({ transcripts: updated });
        } catch (e) {
            console.warn('Failed to save transcript record', e);
        }
    }

    function buildRecord({ id, filename, status, transcript, words, error }) {
        return {
            id,
            filename,
            createdAt: Date.now(),
            status, // 'pending' | 'success' | 'error'
            transcript: transcript || '',
            words: words || [],
            error: error || null,
        };
    }

    async function toBlobFromPayload({ arrayBuffer, dataUrl, mime = 'audio/m4a' }) {
        try {
            if (dataUrl && typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
                const resp = await fetch(dataUrl);
                return await resp.blob();
            }
            if (arrayBuffer instanceof ArrayBuffer) {
                return new Blob([arrayBuffer], { type: mime });
            }
            throw new Error('No valid file payload');
        } catch (e) {
            throw new Error('Failed to build Blob from payload');
        }
    }

    async function uploadPayload({ id, filename, arrayBuffer, dataUrl, token }) {
        const blob = await toBlobFromPayload({ arrayBuffer, dataUrl });
        const formData = new FormData();
        formData.append('audio_file', blob, filename);
        formData.append('nonce', crypto.getRandomValues(new Uint32Array(1))[0].toString(16));

        // Diagnostics
        console.log('[Upload] Starting', { id, filename, size: blob.size, type: blob.type });

        const response = await fetch(`${SERVER_BASE_URL}/transcribe/`, {
            method: 'POST',
            headers: token ? { 'Authorization': `Bearer ${token}` } : {},
            body: formData,
        });

        const rawText = await response.text().catch(() => '');

        if (!response.ok) {
            console.warn('[Upload] Server not OK', { status: response.status, body: rawText?.slice(0, 500) });
            // Try to extract message from text
            try {
                const maybe = JSON.parse(rawText);
                throw new Error(maybe?.message || `Server error ${response.status}`);
            } catch (_) {
                throw new Error(`Server error ${response.status}`);
            }
        }

        let normalized;
        try {
            normalized = parseTranscriptionResponseText(rawText);
        } catch (e) {
            throw new Error(`Invalid response format (${response.status})`);
        }

        if (!normalized || typeof normalized !== 'object') {
            throw new Error('Transcription failed');
        }

        console.log('[Upload] Success', { id, bytes: blob.size });
        return normalized; // { success: true, transcript, words }
    }

    async function startUpload({ filename, arrayBuffer, dataUrl, token }) {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const pendingRecord = buildRecord({ id, filename, status: 'pending' });
        await saveTranscriptRecord(pendingRecord);
        notifyProgress({ id, status: 'pending' });

        try {
            const { transcript, words } = await uploadPayload({ id, filename, arrayBuffer, dataUrl, token });
            const successRecord = buildRecord({ id, filename, status: 'success', transcript, words });

            const { transcripts = [] } = await chrome.storage.local.get(['transcripts']);
            const updated = transcripts.map(t => t.id === id ? successRecord : t);
            await chrome.storage.local.set({ transcripts: updated });

            notifyProgress({ id, status: 'success', transcript });
            return { success: true, id };
        } catch (error) {
            const errorRecord = buildRecord({ id, filename, status: 'error', error: error.message });
            const { transcripts = [] } = await chrome.storage.local.get(['transcripts']);
            const updated = transcripts.map(t => t.id === id ? errorRecord : t);
            await chrome.storage.local.set({ transcripts: updated });

            notifyProgress({ id, status: 'error', message: error.message });
            return { success: false, id, message: error.message };
        }
    }

    function notifyProgress(payload) {
        chrome.runtime.sendMessage({ action: 'uploadProgress', data: payload }).catch(() => {});
    }

    return { startUpload };
})();

// Message handling with security validation
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Security validation
    if (!SecurityManager.validateRequest(request, sender)) {
        sendResponse({ error: 'Unauthorized request' });
        return;
    }
    
    // Handle async operations
    handleMessage(request, sender)
        .then(response => sendResponse(response))
        .catch(error => {
            SecurityManager.logSecurity('message_handling_error', { 
                error: error.message, 
                request: request.action 
            });
            sendResponse({ error: 'Internal error' });
        });
    
    return true; // Keep message channel open for async response
});

async function handleMessage(request, sender) {
    const { action, data } = request;
    
    switch (action) {
        case 'validateAuth':
            return await handleAuthValidation(data);
            
        case 'refreshToken':
            return await handleTokenRefresh(data);
            
        case 'logSecurityEvent':
            SecurityManager.logSecurity(data.event, data.details);
            return { success: true };
            
        case 'checkApiHealth':
            return await checkApiHealth();
            
        case 'startBackgroundUpload': {
            const { filename, arrayBuffer, dataUrl, token } = data || {};
            console.log('[BG] startBackgroundUpload received', {
                hasFilename: !!filename,
                hasArrayBuffer: arrayBuffer instanceof ArrayBuffer,
                arrayBufferType: arrayBuffer ? Object.prototype.toString.call(arrayBuffer) : null,
                hasDataUrl: typeof dataUrl === 'string' && dataUrl.startsWith('data:'),
                dataUrlPrefix: typeof dataUrl === 'string' ? dataUrl.slice(0, 30) : null
            });

            const hasAb = arrayBuffer && (arrayBuffer.byteLength >= 0 || arrayBuffer.size >= 0);
            const hasDu = typeof dataUrl === 'string' && dataUrl.startsWith('data:');

            if (!filename || (!hasAb && !hasDu)) {
                return { success: false, message: 'Missing file data' };
            }
            return await UploadManager.startUpload({ filename, arrayBuffer, dataUrl, token });
        }
        case 'getTranscripts': {
            const { transcripts = [] } = await chrome.storage.local.get(['transcripts']);
            return { success: true, transcripts };
        }
        case 'deleteTranscript': {
            try {
                const id = data?.id;
                if (!id) {
                    return { success: false, message: 'Missing id' };
                }
                const { transcripts = [] } = await chrome.storage.local.get(['transcripts']);
                const updated = transcripts.filter(t => t.id !== id);
                await chrome.storage.local.set({ transcripts: updated });
                return { success: true };
            } catch (e) {
                SecurityManager.logSecurity('delete_transcript_failed', { error: e.message });
                return { success: false, message: 'Failed to delete transcript' };
            }
        }
        case 'updateTranscript': {
            try {
                const { id, transcript: newTranscript, filename: newFilename } = data || {};
                if (!id) {
                    return { success: false, message: 'Missing id' };
                }
                const { transcripts = [] } = await chrome.storage.local.get(['transcripts']);
                let updatedRecord = null;
                const updated = transcripts.map(t => {
                    if (t.id === id) {
                        updatedRecord = { ...t };
                        if (typeof newTranscript === 'string') {
                            updatedRecord.transcript = newTranscript;
                        }
                        if (typeof newFilename === 'string' && newFilename.trim()) {
                            updatedRecord.filename = newFilename.trim();
                        }
                        updatedRecord.updatedAt = Date.now();
                        return updatedRecord;
                    }
                    return t;
                });
                await chrome.storage.local.set({ transcripts: updated });
                return { success: true, transcript: updatedRecord };
            } catch (e) {
                SecurityManager.logSecurity('update_transcript_failed', { error: e.message });
                return { success: false, message: 'Failed to update transcript' };
            }
        }
        default:
            SecurityManager.logSecurity('unknown_action', { action });
            return { error: 'Unknown action' };
    }
}

async function handleAuthValidation(data) {
    try {
        const { userData } = data;
        
        if (!userData || !userData.accessToken) {
            return { valid: false, reason: 'No token provided' };
        }
        
        // Rate limiting check
        if (!SecurityManager.checkRateLimit(userData.id)) {
            return { valid: false, reason: 'Rate limit exceeded' };
        }
        
        const isValid = await AuthManager.validateToken(userData.accessToken);
        return { valid: isValid };
        
    } catch (error) {
        SecurityManager.logSecurity('auth_validation_error', { error: error.message });
        return { valid: false, reason: 'Validation failed' };
    }
}

async function handleTokenRefresh(data) {
    try {
        const { userData } = data;
        const refreshedData = await AuthManager.refreshTokenIfNeeded(userData);
        
        if (refreshedData) {
            return { success: true, userData: refreshedData };
        } else {
            return { success: false, reason: 'Token refresh failed' };
        }
        
    } catch (error) {
        SecurityManager.logSecurity('token_refresh_error', { error: error.message });
        return { success: false, reason: 'Internal error' };
    }
}

async function checkApiHealth() {
    try {
        // This would check your Python server health
        // Replace with your actual server URL
        const serverUrl = 'http://localhost:8000';
        
        const response = await fetch(`${serverUrl}/health`, {
            method: 'GET',
            headers: {
                'X-Extension-Version': chrome.runtime.getManifest().version
            }
        });
        
        if (response.ok) {
            return { healthy: true, status: response.status };
        } else {
            return { healthy: false, status: response.status };
        }
        
    } catch (error) {
        SecurityManager.logSecurity('api_health_check_failed', { error: error.message });
        return { healthy: false, error: error.message };
    }
}

// Cleanup expired data periodically
setInterval(async () => {
    try {
        const result = await chrome.storage.local.get(['userData']);
        
        if (result.userData) {
            const thirtyDays = 30 * 24 * 60 * 60 * 1000;
            const isExpired = Date.now() - result.userData.timestamp > thirtyDays;
            
            if (isExpired) {
                await chrome.storage.local.clear();
                SecurityManager.logSecurity('expired_data_cleaned', { 
                    timestamp: result.userData.timestamp 
                });
            }
        }
    } catch (error) {
        SecurityManager.logSecurity('cleanup_error', { error: error.message });
    }
}, 24 * 60 * 60 * 1000); // Run daily

// Handle service worker suspend lifecycle (do not clear storage here)
chrome.runtime.onSuspend.addListener(async () => {
    try {
        SecurityManager.logSecurity('service_worker_suspended', {});
    } catch (error) {
        console.warn('onSuspend handler error:', error);
    }
});

// Security: Content Security Policy violation handler
// Note: webRequest API monitoring is optional and may require additional permissions
try {
    if (chrome.webRequest && chrome.webRequest.onHeadersReceived) {
        chrome.webRequest.onHeadersReceived.addListener(
            (details) => {
                // Monitor for security violations
                const cspHeader = details.responseHeaders?.find(
                    header => header.name.toLowerCase() === 'content-security-policy'
                );
                
                if (cspHeader && details.url.includes('chat.openai.com')) {
                    SecurityManager.logSecurity('csp_policy_detected', {
                        url: details.url,
                        policy: cspHeader.value
                    });
                }
            },
            { urls: ["https://chat.openai.com/*", "https://chatgpt.com/*"] },
            ["responseHeaders"]
        );
    }
} catch (error) {
    console.warn('WebRequest API not available or insufficient permissions:', error.message);
    // Extension can still function without webRequest monitoring
}

// Initialize security settings
chrome.storage.local.get(['securitySettings']).then(result => {
    if (!result.securitySettings) {
        chrome.storage.local.set({
            securitySettings: {
                enableSecurityLogging: true,
                validateApiRequests: true,
                enforceHttpsOnly: true
            }
        });
    }
});

console.log('Open AudioAi background service worker initialized');