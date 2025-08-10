const { createApp, h, ref, onMounted } = Vue;

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
            'audio/aac', 'audio/m4a', 'audio/mp4', 'audio/x-m4a', 'audio/flac'
        ];
        const allowedExtensions = ['mp3', 'wav', 'ogg', 'aac', 'm4a', 'flac'];
        const maxSize = 100 * 1024 * 1024; // 100MB

        const hasValidMime = !!file.type && allowedTypes.includes(file.type);
        let extension = '';
        if (file.name && file.name.indexOf('.') !== -1) {
            extension = file.name.split('.').pop().toLowerCase();
        }
        const hasValidExtension = allowedExtensions.includes(extension);

        if (!hasValidMime && !hasValidExtension) {
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
                    'X-Nonce': nonce,
                    
                },
                body: JSON.stringify({ ...data, nonce })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('API request failed:', error);
            throw error;
        }
    },

    async uploadAudio(file, token) {
        const formData = new FormData();
        formData.append('audio_file', file);
        formData.append('nonce', SecurityUtils.generateNonce());

        try {
            const response = await fetch(`${this.baseUrl}/transcribe/`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                body: formData
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Audio upload failed:', error);
            throw error;
        }
    }
};

const App = {
    setup() {
        // Reactive state
        const isAuthenticated = ref(false);
        const isLoading = ref(false);
        const user = ref(null);
        const transcript = ref('');
        const isProcessing = ref(false);
        const processingMessage = ref('');
        const error = ref(null);
        const isDragOver = ref(false);
        const isCopied = ref(false);
        const showTokenWarning = ref(false);
        const fileInput = ref(null);
        const transcripts = ref([]);

        // Methods
        const getAuthToken = async (force = false) => {
            try {
                if (force) {
                    try {
                        const data = await chrome.storage.local.get(['authToken']);
                        if (data && data.authToken) {
                            await chrome.identity.removeCachedAuthToken({ token: data.authToken });
                        }
                    } catch (err) {
                        console.warn('Failed to clear cached auth token (non-fatal):', err);
                    }
                }

                const token = await new Promise((resolve, reject) => {
                    try {
                        chrome.identity.getAuthToken({ interactive: true }, (t) => {
                            if (chrome.runtime.lastError || !t) {
                                return reject(chrome.runtime.lastError || new Error('No token returned'));
                            }
                            resolve(t);
                        });
                    } catch (e) {
                        reject(e);
                    }
                });

                await chrome.storage.local.set({ authToken: token });
                return token;
            } catch (e) {
                console.error('getAuthToken failed:', e);
                throw e;
            }
        };


        const signInWithGoogle = async () => {
            if (isLoading.value) return;
            
            isLoading.value = true;
            clearError();
            
            try {
                const token = await getAuthToken();
                await fetchUserInfo(token);
            } catch (error) {
                console.error('Authentication failed:', error);
                showError('Authentication Failed', 'Please try signing in again.');
            } finally {
                isLoading.value = false;
            }
        };

        const fetchUserInfo = async (token) => {
            try {
                const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                if (response.ok) {
                    const userInfo = await response.json();
                    user.value = {
                        name: SecurityUtils.sanitizeInput(userInfo.name),
                        email: SecurityUtils.sanitizeInput(userInfo.email),
                        picture: userInfo.picture // URL from Google is safe
                    };
                    isAuthenticated.value = true;
                    
                    // Store user data securely
                    await chrome.storage.local.set({
                        user: user.value,
                        isAuthenticated: true,
                        authToken: token
                    });
                } else if (response.status === 401) {
                    const refreshed = await getAuthToken(true);
                    return await fetchUserInfo(refreshed);
                } else {
                    throw new Error('Failed to fetch user info');
                }
            } catch (error) {
                console.error('Failed to fetch user info:', error);
                showError('Failed to fetch user information', 'Please try signing in again.');
            }
        };

        const logout = async () => {
            try {
                const data = await chrome.storage.local.get(['authToken']);
                if (data.authToken) {
                    try {
                        await chrome.identity.removeCachedAuthToken({ token: data.authToken });
                    } catch (_) {}

                    try {
                        await fetch('https://oauth2.googleapis.com/revoke', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                            body: `token=${encodeURIComponent(data.authToken)}`
                        });
                    } catch (_) {}
                }

                await new Promise((resolve) => chrome.identity.clearAllCachedAuthTokens(() => resolve()));
                await chrome.storage.local.clear();
                user.value = null;
                isAuthenticated.value = false;
                resetUpload();
                transcripts.value = [];
            } catch (error) {
                console.error('Logout failed:', error);
            }
        };

        const handleFileSelect = (event) => {
            const file = event.target.files[0];
            if (file) {
                processAudioFile(file);
            }
        };

        const handleDrop = (event) => {
            event.preventDefault();
            isDragOver.value = false;
            
            const files = event.dataTransfer.files;
            if (files.length > 0) {
                processAudioFile(files[0]);
            }
        };

        const handleDragOver = (event) => {
            event.preventDefault();
            isDragOver.value = true;
        };

        const handleDragLeave = (event) => {
            event.preventDefault();
            isDragOver.value = false;
        };

        const processAudioFile = async (file) => {
            try {
                SecurityUtils.validateAudioFile(file);
                isProcessing.value = true;
                processingMessage.value = 'Sending to background for upload...';
                clearError();

                // Read file into ArrayBuffer for transfer to background
                const arrayBuffer = await file.arrayBuffer();

                // Start background upload via service worker
                const response = await chrome.runtime.sendMessage({
                    action: 'uploadAudioInBackground',
                    data: {
                        fileName: file.name,
                        mimeType: file.type || 'application/octet-stream',
                        originalSize: file.size,
                        arrayBuffer
                    }
                });

                if (!response || !response.started) {
                    throw new Error(response?.error || 'Failed to start background upload');
                }

                processingMessage.value = 'Upload started in background. You can close this popup.';
                // Reset local UI upload state; background will handle persistence
                setTimeout(() => {
                    resetUpload();
                    // Optionally refresh transcripts list after a short delay
                    refreshTranscripts();
                }, 800);
            } catch (error) {
                console.error('File processing failed:', error);
                showError('Processing Failed', error.message);
            } finally {
                if (fileInput.value) {
                    fileInput.value.value = '';
                }
            }
        };

        const copyTranscript = async () => {
            try {
                await navigator.clipboard.writeText(transcript.value);
                isCopied.value = true;
                setTimeout(() => {
                    isCopied.value = false;
                }, 2000);
            } catch (error) {
                console.error('Failed to copy transcript:', error);
                showError('Copy Failed', 'Failed to copy transcript to clipboard.');
            }
        };

        const sendToChatGPT = async () => {
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                
                if (tab.url && (tab.url.includes('chat.openai.com') || tab.url.includes('chatgpt.com'))) {
                    await chrome.tabs.sendMessage(tab.id, {
                        action: 'insertTranscript',
                        transcript: transcript.value
                    });
                    window.close();
                } else {
                    // Open ChatGPT in new tab
                    chrome.tabs.create({ 
                        url: 'https://chat.openai.com/',
                        active: true 
                    });
                    
                    // Store transcript for insertion when page loads
                    await chrome.storage.local.set({
                        pendingTranscript: transcript.value
                    });
                    
                    window.close();
                }
            } catch (error) {
                console.error('Failed to send to ChatGPT:', error);
                showError('Send Failed', 'Failed to send transcript to ChatGPT.');
            }
        };

        const resetUpload = () => {
            transcript.value = '';
            isProcessing.value = false;
            processingMessage.value = '';
            clearError();
            if (fileInput.value) {
                fileInput.value.value = '';
            }
        };

        const showError = (title, message) => {
            error.value = {
                title: SecurityUtils.sanitizeInput(title),
                message: SecurityUtils.sanitizeInput(message)
            };
        };

        const clearError = () => {
            error.value = null;
        };

        const closeTokenWarning = () => {
            showTokenWarning.value = false;
        };

        const openFileDialog = () => {
            if (fileInput.value) {
                fileInput.value.click();
            }
        };

        const refreshTranscripts = async () => {
            try {
                const { transcripts: stored } = await chrome.storage.local.get(['transcripts']);
                transcripts.value = Array.isArray(stored) ? stored : [];
            } catch (e) {
                console.warn('Failed to load transcripts:', e);
            }
        };

        // Initialize app
        onMounted(async () => {
            try {
                const data = await chrome.storage.local.get(['user', 'isAuthenticated', 'authToken', 'transcripts']);
                if (data.isAuthenticated && data.user && data.authToken) {
                    user.value = data.user;
                    isAuthenticated.value = true;
                }
                transcripts.value = Array.isArray(data.transcripts) ? data.transcripts : [];

                // Listen for storage changes to keep list live
                chrome.storage.onChanged.addListener((changes, area) => {
                    if (area === 'local' && changes.transcripts) {
                        transcripts.value = changes.transcripts.newValue || [];
                    }
                });
            } catch (error) {
                console.error('Failed to load stored data:', error);
            }
        });

        return {
            // State
            isAuthenticated,
            isLoading,
            user,
            transcript,
            isProcessing,
            processingMessage,
            error,
            isDragOver,
            isCopied,
            showTokenWarning,
            fileInput,
            transcripts,
            // Methods
            signInWithGoogle,
            logout,
            handleFileSelect,
            handleDrop,
            handleDragOver,
            handleDragLeave,
            copyTranscript,
            sendToChatGPT,
            resetUpload,
            clearError,
            closeTokenWarning,
            openFileDialog,
            refreshTranscripts
        };
    },

    render() {
        const { 
            isAuthenticated, isLoading, user, transcript, isProcessing, 
            processingMessage, error, isDragOver, isCopied, showTokenWarning,
            signInWithGoogle, logout, handleFileSelect, 
            handleDrop, handleDragOver, handleDragLeave, copyTranscript, sendToChatGPT, 
            resetUpload, clearError, closeTokenWarning, openFileDialog, transcripts
        } = this;

        return h('div', [
            // Header
            h('div', { class: 'header' }, [
                h('img', { src: 'icons/icon32.png', alt: 'Open AudioAi', class: 'logo' }),
                h('h1', 'Open AudioAi'),
                isAuthenticated && h('button', { 
                    class: 'logout-btn',
                    onClick: logout 
                }, [
                    h('span', { class: 'logout-icon' }, '🚪')
                ])
            ]),

            // Authentication Section
            !isAuthenticated && h('div', { class: 'auth-section' }, [
                h('div', { class: 'welcome-message' }, [
                    h('h2', 'Welcome to Open AudioAi'),
                    h('p', 'Transform your audio into insights with ChatGPT')
                ]),
                h('button', {
                    class: 'google-signin-btn',
                    disabled: isLoading,
                    onClick: signInWithGoogle
                }, [
                    h('img', { src: 'icons/google-logo.png', alt: 'Google', class: 'google-logo' }),
                    h('span', isLoading ? 'Signing in...' : 'Sign in with Google')
                ]),

            ]),

            // Main Application
            isAuthenticated && h('div', { class: 'main-app' }, [
                // User info
                h('div', { class: 'user-info' }, [
                    h('img', { src: user.picture, alt: user.name, class: 'user-avatar' }),
                    h('div', { class: 'user-details' }, [
                        h('span', { class: 'user-name' }, user.name),
                        h('span', { class: 'user-email' }, user.email)
                    ])
                ]),

                // Upload section
                h('div', { class: 'upload-section' }, [
                    // Upload area
                    !isProcessing && !transcript && h('div', {
                        class: ['upload-area', { 'drag-over': isDragOver }],
                        onDrop: handleDrop,
                        onDragover: handleDragOver,
                        onDragleave: handleDragLeave
                    }, [
                        h('input', {
                            type: 'file',
                            ref: 'fileInput',
                            accept: 'audio/*',
                            style: 'display: none;',
                            onChange: handleFileSelect
                        }),
                        h('div', { class: 'upload-content' }, [
                            h('div', { class: 'upload-icon' }, '🎵'),
                            h('h3', 'Upload Audio File'),
                            h('p', 'Drag & drop or click to select'),
                            h('button', {
                                class: 'upload-btn',
                                onClick: openFileDialog
                            }, 'Choose File')
                        ])
                    ]),

                    // Processing info
                    isProcessing && h('div', { class: 'processing-section' }, [
                        h('div', { class: 'loading-animation' }, [
                            h('div', { class: 'audio-wave' }, 
                                Array.from({ length: 5 }, (_, i) => 
                                    h('div', {
                                        class: 'wave-bar',
                                        style: { animationDelay: `${i * 0.1}s` }
                                    })
                                )
                            )
                        ]),
                        h('h3', 'Processing...'),
                        h('p', processingMessage)
                    ]),

                    // Latest transcript display (kept for compatibility)
                    transcript && !isProcessing && h('div', { class: 'transcript-section' }, [
                        h('div', { class: 'transcript-header' }, [
                            h('h3', 'Transcript Ready'),
                            h('div', { class: 'action-buttons' }, [
                                h('button', {
                                    class: ['copy-btn', { 'copied': isCopied }],
                                    onClick: copyTranscript
                                }, isCopied ? '✓ Copied' : '📋 Copy'),
                                h('button', {
                                    class: 'send-btn',
                                    onClick: sendToChatGPT
                                }, '🚀 Send to ChatGPT')
                            ])
                        ]),
                        h('div', { class: 'transcript-content' }, [
                            h('textarea', {
                                class: 'transcript-text',
                                readonly: true,
                                value: transcript
                            })
                        ]),
                        h('button', {
                            class: 'reset-btn',
                            onClick: resetUpload
                        }, 'Upload Another File')
                    ]),

                    // Error display
                    error && h('div', { class: 'error-section' }, [
                        h('div', { class: 'error-icon' }, '⚠️'),
                        h('h3', error.title),
                        h('p', error.message),
                        h('button', {
                            class: 'retry-btn',
                            onClick: clearError
                        }, 'Try Again')
                    ])
                ]),

                // Saved transcripts list
                h('div', { class: 'saved-section' }, [
                    h('h3', 'Saved Transcripts'),
                    transcripts && transcripts.length > 0
                        ? h('ul', { class: 'transcript-list' },
                            transcripts.map((item) => h('li', { class: 'transcript-item' }, [
                                h('div', { class: 'transcript-meta' }, [
                                    h('span', { class: 'file-name' }, item.fileName || 'Unknown file'),
                                    h('span', { class: 'status' }, item.status)
                                ]),
                                item.status === 'done' && item.transcript && h('div', { class: 'transcript-preview' }, [
                                    h('textarea', {
                                        class: 'transcript-text small',
                                        readonly: true,
                                        value: item.transcript
                                    })
                                ]),
                                item.status === 'error' && h('div', { class: 'transcript-error' }, [
                                    h('span', item.errorMessage || 'Failed')
                                ])
                            ]))
                        )
                        : h('p', { class: 'empty-state' }, 'No transcripts yet')
                ])
            ])
        ]);
    }
};

createApp(App).mount('#app');