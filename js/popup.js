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
    baseUrl: 'http://localhost:8000', // Replace with actual server URL

    async makeSecureRequest(endpoint, data, token) {
        const nonce = SecurityUtils.generateNonce();
        
        try {
            const response = await fetch(`${this.baseUrl}${endpoint}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-Request-Nonce': nonce,
                    'X-Extension-Version': chrome.runtime.getManifest().version
                },
                body: JSON.stringify({
                    ...data,
                    nonce,
                    timestamp: Date.now()
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error('API request failed:', error);
            throw error;
        }
    },

    async uploadAudio(audioFile, token) {
        const formData = new FormData();
        formData.append('audio', audioFile);
        formData.append('nonce', SecurityUtils.generateNonce());
        formData.append('timestamp', Date.now());

        try {
            const response = await fetch(`${this.baseUrl}/api/transcribe`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Extension-Version': chrome.runtime.getManifest().version
                },
                body: formData
            });

            if (!response.ok) {
                throw new Error(`Upload failed: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Audio upload failed:', error);
            throw error;
        }
    }
};

// Main Application Class
class AudioAiApp {
    constructor() {
        this.isAuthenticated = false;
        this.user = null;
        this.isProcessing = false;
        this.transcript = '';
        this.error = null;
        this.isDragOver = false;
        this.isCopied = false;
        this.showTokenWarning = false;
        
        this.init();
    }

    init() {
        this.bindEvents();
        this.checkAuthStatus();
    }

    bindEvents() {
        // Authentication
        document.getElementById('google-signin-btn').addEventListener('click', () => this.signInWithGoogle());
        document.getElementById('logout-btn').addEventListener('click', () => this.logout());

        // File upload
        document.getElementById('upload-btn').addEventListener('click', () => {
            document.getElementById('file-input').click();
        });
        document.getElementById('file-input').addEventListener('change', (e) => this.handleFileSelect(e));

        // Drag and drop
        const uploadArea = document.getElementById('upload-area');
        uploadArea.addEventListener('drop', (e) => this.handleDrop(e));
        uploadArea.addEventListener('dragover', (e) => this.handleDragOver(e));
        uploadArea.addEventListener('dragleave', (e) => this.handleDragLeave(e));

        // Actions
        document.getElementById('copy-btn').addEventListener('click', () => this.copyTranscript());
        document.getElementById('send-btn').addEventListener('click', () => this.sendToChatGPT());
        document.getElementById('reset-btn').addEventListener('click', () => this.resetUpload());
        document.getElementById('retry-btn').addEventListener('click', () => this.clearError());

        // Modal
        document.getElementById('close-modal-btn').addEventListener('click', () => this.closeTokenWarning());
        document.getElementById('modal-understood-btn').addEventListener('click', () => this.closeTokenWarning());
        document.getElementById('token-modal').addEventListener('click', (e) => {
            if (e.target.id === 'token-modal') this.closeTokenWarning();
        });
    }

    async checkAuthStatus() {
        try {
            const result = await chrome.storage.local.get(['user', 'accessToken']);
            if (result.user && result.accessToken) {
                this.user = result.user;
                this.isAuthenticated = true;
                this.updateUI();
            }
        } catch (error) {
            console.error('Error checking auth status:', error);
        }
    }

    async signInWithGoogle() {
        const signInBtn = document.getElementById('google-signin-btn');
        const signInText = signInBtn.querySelector('span');
        
        signInText.textContent = 'Signing in...';
        signInBtn.disabled = true;

        try {
            const token = await chrome.identity.getAuthToken({ interactive: true });
            
            // Get user info from Google API
            const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                throw new Error('Failed to get user info');
            }

            const userInfo = await response.json();
            
            // Store user data securely
            await chrome.storage.local.set({
                user: {
                    id: userInfo.id,
                    name: SecurityUtils.sanitizeInput(userInfo.name),
                    email: SecurityUtils.sanitizeInput(userInfo.email),
                    picture: userInfo.picture
                },
                accessToken: token
            });

            this.user = userInfo;
            this.isAuthenticated = true;
            this.updateUI();

        } catch (error) {
            console.error('Authentication failed:', error);
            this.showError('Authentication Failed', 'Unable to sign in with Google. Please try again.');
        } finally {
            signInText.textContent = 'Sign in with Google';
            signInBtn.disabled = false;
        }
    }

    async logout() {
        try {
            await chrome.identity.removeCachedAuthToken({
                token: (await chrome.storage.local.get(['accessToken'])).accessToken
            });
            await chrome.storage.local.clear();
            
            this.isAuthenticated = false;
            this.user = null;
            this.resetUpload();
            this.updateUI();
        } catch (error) {
            console.error('Logout failed:', error);
        }
    }

    handleFileSelect(event) {
        const file = event.target.files[0];
        if (file) {
            this.processAudioFile(file);
        }
    }

    handleDrop(event) {
        event.preventDefault();
        this.isDragOver = false;
        this.updateUploadAreaStyle();

        const files = event.dataTransfer.files;
        if (files.length > 0) {
            this.processAudioFile(files[0]);
        }
    }

    handleDragOver(event) {
        event.preventDefault();
        this.isDragOver = true;
        this.updateUploadAreaStyle();
    }

    handleDragLeave(event) {
        event.preventDefault();
        this.isDragOver = false;
        this.updateUploadAreaStyle();
    }

    updateUploadAreaStyle() {
        const uploadArea = document.getElementById('upload-area');
        if (this.isDragOver) {
            uploadArea.classList.add('drag-over');
        } else {
            uploadArea.classList.remove('drag-over');
        }
    }

    async processAudioFile(file) {
        try {
            SecurityUtils.validateAudioFile(file);
            
            this.isProcessing = true;
            this.error = null;
            this.updateUI();

            const result = await chrome.storage.local.get(['accessToken']);
            if (!result.accessToken) {
                throw new Error('Not authenticated');
            }

            // Simulate processing (replace with actual API call)
            await this.simulateProcessing();
            
            // For demo purposes, generate a mock transcript
            this.transcript = `[00:00] This is a sample transcript of your audio file: ${file.name}\n[00:05] The audio processing has been completed successfully.\n[00:10] You can now copy this transcript or send it to ChatGPT for analysis.`;
            
            this.isProcessing = false;
            this.updateUI();

        } catch (error) {
            console.error('File processing failed:', error);
            this.isProcessing = false;
            
            if (error.message.includes('tokens')) {
                this.showTokenWarning = true;
            } else {
                this.showError('Processing Failed', error.message);
            }
            this.updateUI();
        }
    }

    async simulateProcessing() {
        const messages = [
            'Uploading audio file...',
            'Analyzing audio content...',
            'Generating transcript...',
            'Adding timestamps...',
            'Finalizing results...'
        ];

        for (let i = 0; i < messages.length; i++) {
            document.getElementById('processing-message').textContent = messages[i];
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    async copyTranscript() {
        try {
            await navigator.clipboard.writeText(this.transcript);
            const copyBtn = document.getElementById('copy-btn');
            copyBtn.textContent = '✓ Copied';
            copyBtn.classList.add('copied');
            
            setTimeout(() => {
                copyBtn.textContent = '📋 Copy';
                copyBtn.classList.remove('copied');
            }, 2000);
        } catch (error) {
            console.error('Failed to copy transcript:', error);
        }
    }

    async sendToChatGPT() {
        try {
            // Find active ChatGPT tab
            const tabs = await chrome.tabs.query({
                url: ['https://chat.openai.com/*', 'https://chatgpt.com/*']
            });

            if (tabs.length === 0) {
                // Open new ChatGPT tab
                const newTab = await chrome.tabs.create({
                    url: 'https://chat.openai.com',
                    active: true
                });
                
                // Wait for tab to load then inject transcript
                setTimeout(() => {
                    chrome.tabs.sendMessage(newTab.id, {
                        action: 'insertTranscript',
                        transcript: this.transcript
                    });
                }, 3000);
            } else {
                // Use existing tab
                chrome.tabs.update(tabs[0].id, { active: true });
                chrome.tabs.sendMessage(tabs[0].id, {
                    action: 'insertTranscript',
                    transcript: this.transcript
                });
            }
            
            window.close();
        } catch (error) {
            console.error('Failed to send to ChatGPT:', error);
            this.showError('Send Failed', 'Unable to send transcript to ChatGPT. Please try again.');
        }
    }

    resetUpload() {
        this.transcript = '';
        this.error = null;
        this.isProcessing = false;
        this.isCopied = false;
        document.getElementById('file-input').value = '';
        this.updateUI();
    }

    showError(title, message) {
        this.error = { title, message };
        this.updateUI();
    }

    clearError() {
        this.error = null;
        this.updateUI();
    }

    closeTokenWarning() {
        this.showTokenWarning = false;
        this.updateUI();
    }

    updateUI() {
        // Show/hide main sections
        document.getElementById('auth-section').style.display = this.isAuthenticated ? 'none' : 'flex';
        document.getElementById('main-app').style.display = this.isAuthenticated ? 'flex' : 'none';
        document.getElementById('logout-btn').style.display = this.isAuthenticated ? 'block' : 'none';

        if (this.isAuthenticated && this.user) {
            document.getElementById('user-avatar').src = this.user.picture || '';
            document.getElementById('user-avatar').alt = this.user.name || '';
            document.getElementById('user-name').textContent = this.user.name || '';
            document.getElementById('user-email').textContent = this.user.email || '';
        }

        // Show/hide upload states
        document.getElementById('upload-area').style.display = 
            (!this.isProcessing && !this.transcript && !this.error) ? 'block' : 'none';
        document.getElementById('processing-section').style.display = 
            this.isProcessing ? 'block' : 'none';
        document.getElementById('transcript-section').style.display = 
            (this.transcript && !this.isProcessing && !this.error) ? 'block' : 'none';
        document.getElementById('error-section').style.display = 
            this.error ? 'block' : 'none';

        if (this.error) {
            document.getElementById('error-title').textContent = this.error.title;
            document.getElementById('error-message').textContent = this.error.message;
        }

        if (this.transcript) {
            document.getElementById('transcript-text').value = this.transcript;
        }

        // Modal
        document.getElementById('token-modal').style.display = 
            this.showTokenWarning ? 'flex' : 'none';
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    new AudioAiApp();
});