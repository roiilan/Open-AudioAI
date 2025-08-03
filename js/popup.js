const { createApp } = Vue;

// Security utilities
const SecurityUtils = {
    // Sanitize user input to prevent XSS
    sanitizeInput(input) {
        if (typeof input !== 'string') return input;
        return input
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;');
    },

    // Validate file type and size
    validateAudioFile(file) {
        const allowedTypes = [
            'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 
            'audio/aac', 'audio/m4a', 'audio/flac'
        ];
        const maxSize = 100 * 1024 * 1024; // 100MB

        if (!allowedTypes.includes(file.type)) {
            throw new Error('Invalid file type. Please upload an audio file.');
        }

        if (file.size > maxSize) {
            throw new Error('File too large. Please upload a file smaller than 100MB.');
        }

        return true;
    },

    // Generate secure random nonce for requests
    generateNonce() {
        const array = new Uint8Array(16);
        crypto.getRandomValues(array);
        return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    }
};

// API Service for secure communication
const ApiService = {
    baseUrl: 'http://localhost:8000', // Local development server

    async makeSecureRequest(endpoint, data, token) {
        const nonce = SecurityUtils.generateNonce();
        
        try {
            const response = await fetch(`${this.baseUrl}${endpoint}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-Nonce': nonce,
                    'X-Extension-Version': chrome.runtime.getManifest().version
                },
                body: JSON.stringify({
                    ...data,
                    nonce: nonce,
                    timestamp: Date.now()
                })
            });

            if (!response.ok) {
                throw new Error(`Server error: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('API request failed:', error);
            throw error;
        }
    },

    async uploadAudio(file, userToken) {
        const formData = new FormData();
        formData.append('audio', file);
        formData.append('nonce', SecurityUtils.generateNonce());
        formData.append('timestamp', Date.now().toString());

        try {
            const response = await fetch(`${this.baseUrl}/transcribe`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${userToken}`,
                    'X-Extension-Version': chrome.runtime.getManifest().version
                },
                body: formData
            });

            if (!response.ok) {
                throw new Error(`Upload failed: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Audio upload failed:', error);
            throw error;
        }
    }
};

// Storage utility for secure data handling
const StorageUtils = {
    async saveUserData(userData) {
        const encryptedData = {
            ...userData,
            timestamp: Date.now(),
            version: chrome.runtime.getManifest().version
        };
        
        await chrome.storage.local.set({ 
            userData: encryptedData,
            isAuthenticated: true 
        });
    },

    async getUserData() {
        const result = await chrome.storage.local.get(['userData', 'isAuthenticated']);
        if (result.isAuthenticated && result.userData) {
            // Validate data freshness (30 days)
            const thirtyDays = 30 * 24 * 60 * 60 * 1000;
            if (Date.now() - result.userData.timestamp > thirtyDays) {
                await this.clearUserData();
                return null;
            }
            return result.userData;
        }
        return null;
    },

    async clearUserData() {
        await chrome.storage.local.clear();
    }
};

// Vue.js Application
createApp({
    data() {
        return {
            isAuthenticated: false,
            isLoading: false,
            isProcessing: false,
            isDragOver: false,
            isCopied: false,
            showTokenWarning: false,
            user: null,
            transcript: '',
            processingMessage: 'Uploading and analyzing your audio...',
            error: null,
            userToken: null
        };
    },

    async mounted() {
        await this.checkAuthStatus();
    },

    methods: {
        async checkAuthStatus() {
            try {
                const userData = await StorageUtils.getUserData();
                if (userData) {
                    this.user = userData;
                    this.userToken = userData.accessToken;
                    this.isAuthenticated = true;
                }
            } catch (error) {
                console.error('Auth check failed:', error);
                await StorageUtils.clearUserData();
            }
        },

        async signInWithGoogle() {
            this.isLoading = true;
            this.clearError();

            try {
                const token = await new Promise((resolve, reject) => {
                    chrome.identity.getAuthToken({ interactive: true }, (token) => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                        } else {
                            resolve(token);
                        }
                    });
                });

                // Get user info from Google API
                const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                    headers: { Authorization: `Bearer ${token}` }
                });

                if (!userResponse.ok) {
                    throw new Error('Failed to get user information');
                }

                const userInfo = await userResponse.json();
                
                // Sanitize user data
                const sanitizedUser = {
                    id: SecurityUtils.sanitizeInput(userInfo.id),
                    name: SecurityUtils.sanitizeInput(userInfo.name),
                    email: SecurityUtils.sanitizeInput(userInfo.email),
                    picture: userInfo.picture, // Google URLs are safe
                    accessToken: token
                };

                await StorageUtils.saveUserData(sanitizedUser);
                
                this.user = sanitizedUser;
                this.userToken = token;
                this.isAuthenticated = true;

            } catch (error) {
                console.error('Sign-in failed:', error);
                this.showError('Authentication Failed', 'Unable to sign in with Google. Please try again.');
            } finally {
                this.isLoading = false;
            }
        },

        async logout() {
            try {
                // Revoke token
                if (this.userToken) {
                    chrome.identity.removeCachedAuthToken({ token: this.userToken });
                }

                await StorageUtils.clearUserData();
                
                this.isAuthenticated = false;
                this.user = null;
                this.userToken = null;
                this.transcript = '';
                this.clearError();

            } catch (error) {
                console.error('Logout failed:', error);
            }
        },

        handleDragOver(e) {
            e.preventDefault();
            this.isDragOver = true;
        },

        handleDragLeave(e) {
            e.preventDefault();
            this.isDragOver = false;
        },

        handleDrop(e) {
            e.preventDefault();
            this.isDragOver = false;
            
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.processFile(files[0]);
            }
        },

        handleFileSelect(e) {
            const file = e.target.files[0];
            if (file) {
                this.processFile(file);
            }
        },

        async processFile(file) {
            this.clearError();
            
            try {
                // Validate file
                SecurityUtils.validateAudioFile(file);
                
                this.isProcessing = true;
                this.processingMessage = 'Uploading and analyzing your audio...';

                // Upload to server
                const response = await ApiService.uploadAudio(file, this.userToken);
                
                if (response.code === 2) {
                    // Insufficient tokens
                    this.showTokenWarning = true;
                    this.isProcessing = false;
                    return;
                }

                if (response.code === 1 && response.transcript) {
                    // Success
                    this.transcript = SecurityUtils.sanitizeInput(response.transcript);
                    await this.copyTranscript(); // Auto-copy
                    this.isProcessing = false;
                } else {
                    throw new Error('Invalid response from server');
                }

            } catch (error) {
                this.isProcessing = false;
                console.error('File processing failed:', error);
                
                if (error.message.includes('Invalid file type')) {
                    this.showError('Invalid File Type', error.message);
                } else if (error.message.includes('File too large')) {
                    this.showError('File Too Large', error.message);
                } else if (error.message.includes('Server error')) {
                    this.showError('Server Error', 'Unable to process audio. Please try again later.');
                } else {
                    this.showError('Processing Failed', 'An error occurred while processing your audio file.');
                }
            }
        },

        async copyTranscript() {
            try {
                await navigator.clipboard.writeText(this.transcript);
                this.isCopied = true;
                setTimeout(() => {
                    this.isCopied = false;
                }, 2000);
            } catch (error) {
                console.error('Copy failed:', error);
            }
        },

        async sendToChatGPT() {
            try {
                // First copy to clipboard
                await this.copyTranscript();

                // Get active tab and inject the transcript
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                
                if (tab && (tab.url.includes('chat.openai.com') || tab.url.includes('chatgpt.com'))) {
                    // Send message to content script
                    chrome.tabs.sendMessage(tab.id, {
                        action: 'insertTranscript',
                        transcript: this.transcript
                    });
                } else {
                    // Open ChatGPT in new tab
                    chrome.tabs.create({ url: 'https://chat.openai.com' });
                }
            } catch (error) {
                console.error('Failed to send to ChatGPT:', error);
                this.showError('Integration Failed', 'Unable to send transcript to ChatGPT. The transcript has been copied to your clipboard.');
            }
        },

        resetUpload() {
            this.transcript = '';
            this.isProcessing = false;
            this.clearError();
            
            // Reset file input
            if (this.$refs.fileInput) {
                this.$refs.fileInput.value = '';
            }
        },

        showError(title, message) {
            this.error = {
                title: SecurityUtils.sanitizeInput(title),
                message: SecurityUtils.sanitizeInput(message)
            };
        },

        clearError() {
            this.error = null;
        },

        closeTokenWarning() {
            this.showTokenWarning = false;
        }
    }
}).mount('#app');