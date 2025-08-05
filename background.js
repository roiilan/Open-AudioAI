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
            // Verify token with Google
            const response = await fetch('https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=' + token);
            const tokenInfo = await response.json();
            
            if (tokenInfo.error) {
                SecurityManager.logSecurity('invalid_token', { error: tokenInfo.error });
                return false;
            }
            
            // Check token expiration
            const expiresIn = parseInt(tokenInfo.expires_in);
            if (expiresIn < 300) { // Less than 5 minutes
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

// Handle extension uninstall/disable
chrome.runtime.onSuspend.addListener(async () => {
    try {
        // Clean up sensitive data
        await chrome.storage.local.clear();
        
        // Revoke authentication tokens
        const result = await chrome.storage.local.get(['userData']);
        if (result.userData && result.userData.accessToken) {
            chrome.identity.removeCachedAuthToken({ 
                token: result.userData.accessToken 
            });
        }
        
        SecurityManager.logSecurity('extension_suspended', {});
    } catch (error) {
        console.error('Error during extension suspension:', error);
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