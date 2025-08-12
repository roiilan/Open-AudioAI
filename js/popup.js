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
        const maxSize = 500 * 1024 * 1024; // 500MB

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
            throw new Error('File too large. Please upload a file smaller than 500MB.');
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

            const text = await response.text();

            if (!response.ok) {
                let errorMessage = `HTTP error! status: ${response.status}`;
                try {
                    const errObj = text ? JSON.parse(text) : null;
                    if (errObj?.message) errorMessage = errObj.message;
                } catch (_) {}
                throw new Error(errorMessage);
            }

            // Normalize 200 OK responses
            try {
                const obj = text ? JSON.parse(text) : {};
                if (typeof obj === 'object' && obj !== null) {
                    // New format preferred
                    if (typeof obj.code !== 'undefined') {
                        return obj;
                    }
                    // Legacy or partial: assume success
                    return {
                        code: 1,
                        transcript: obj.transcript || text || '',
                        words: Array.isArray(obj.words) ? obj.words : []
                    };
                }
            } catch (_) {
                // Not JSON; treat whole body as transcript
                return { code: 1, transcript: text || '', words: [] };
            }

            // Fallback
            return { code: 1, transcript: text || '', words: [] };
        } catch (error) {
            console.error('Audio upload failed:', error);
            throw error;
        }
    }
};

// Helper: combine transcript text and words into single text for display/copy
function buildCombinedTranscript(transcript, words) {
    try {
        const payload = {
            transcript: transcript || '',
            words: Array.isArray(words) ? words : []
        };
        return JSON.stringify(payload, null, 2);
    } catch (e) {
        return (typeof transcript === 'string' ? transcript : '') + '\n\n[words unavailable]';
    }
}

// Replace direct upload with background upload via messaging and load stored transcripts
const BackgroundBridge = {
    startUpload(data) {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage(
                { action: 'startBackgroundUpload', data },
                (response) => resolve(response || { success: false, message: 'No response' })
            );
        });
    },
    async getTranscripts() {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: 'getTranscripts' }, (res) => resolve(res));
        });
    }
};

// Listen for progress from background
chrome.runtime.onMessage.addListener((request) => {
    if (request?.action === 'uploadProgress') {
        // Optionally update UI reactively if needed
    }
});

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
        const copiedItemId = ref(null);
        const showTokenWarning = ref(false);
        const fileInput = ref(null);
        const transcriptsList = ref([]);
        const editingId = ref(null);
        const editingText = ref('');
        const editingFilename = ref('');

        // Extend BackgroundBridge methods
        BackgroundBridge.deleteTranscript = (id) => new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: 'deleteTranscript', data: { id } }, (res) => resolve(res));
        });
        BackgroundBridge.updateTranscript = (payload) => new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: 'updateTranscript', data: payload }, (res) => resolve(res));
        });
        
        const updateEditingText = (e) => {
            editingText.value = e?.target?.value ?? '';
        };
        const updateEditingFilename = (e) => {
            editingFilename.value = e?.target?.value ?? '';
        };

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
                clearError();

                const data = await chrome.storage.local.get(['authToken', 'transcripts']);
                if (!data.authToken) {
                    throw new Error('Authentication required');
                }

                // Create a pending record immediately
                const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                const pendingRecord = {
                    id,
                    filename: file.name || 'audio.m4a',
                    createdAt: Date.now(),
                    status: 'pending',
                    transcript: '',
                    words: [],
                    error: null
                };
                const existing = Array.isArray(data.transcripts) ? data.transcripts : [];
                await chrome.storage.local.set({ transcripts: [pendingRecord, ...existing] });
                await loadTranscripts();

                // Upload directly to server with the File to support large sizes
                const result = await ApiService.uploadAudio(file, data.authToken);

                // New format: { code: 1 | 2, transcript?: string, words?: Array }
                if (!result || result.code !== 1) {
                    throw new Error(result?.message || 'Upload failed');
                }

                // Update the record to success
                const { transcripts = [] } = await chrome.storage.local.get(['transcripts']);
                const combinedText = buildCombinedTranscript(result.transcript, result.words);
                const updated = transcripts.map(t => t.id === id ? ({
                    ...t,
                    status: 'success',
                    transcript: combinedText,
                    words: Array.isArray(result.words) ? result.words : [],
                    error: null
                }) : t);
                await chrome.storage.local.set({ transcripts: updated });
                await loadTranscripts();
            } catch (error) {
                console.error('File processing failed:', error);
                if (error.message.includes('tokens') || error.message.includes('quota')) {
                    showTokenWarning.value = true;
                } else {
                    // Mark latest pending as error if exists
                    try {
                        const { transcripts = [] } = await chrome.storage.local.get(['transcripts']);
                        const idx = transcripts.findIndex(t => t.status === 'pending');
                        if (idx !== -1) {
                            transcripts[idx] = { ...transcripts[idx], status: 'error', error: error.message };
                            await chrome.storage.local.set({ transcripts });
                            await loadTranscripts();
                        }
                    } catch (_) {}
                    showError('Processing Failed', error.message);
                }
            } finally {
                if (fileInput.value) fileInput.value.value = '';
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

        const copySavedTranscript = async (item, event) => {
            try {
                if (event) event.stopPropagation();
                await navigator.clipboard.writeText(item.transcript || '');
                copiedItemId.value = item.id;
                setTimeout(() => { copiedItemId.value = null; }, 1500);
            } catch (e) {
                console.error('Copy saved transcript failed:', e);
            }
        };

        const startEdit = (item, event) => {
            if (event) event.stopPropagation();
            editingId.value = item.id;
            editingText.value = item.transcript || '';
            editingFilename.value = item.filename || '';
        };

        const cancelEdit = (event) => {
            if (event) event.stopPropagation();
            editingId.value = null;
            editingText.value = '';
            editingFilename.value = '';
        };

        const saveEdit = async (event) => {
            try {
                if (event) event.stopPropagation();
                if (!editingId.value) return;
                const res = await BackgroundBridge.updateTranscript({
                    id: editingId.value,
                    transcript: editingText.value,
                    filename: editingFilename.value
                });
                if (res?.success) {
                    await loadTranscripts();
                    editingId.value = null;
                    editingText.value = '';
                    editingFilename.value = '';
                }
            } catch (e) {
                console.error('Save edit failed:', e);
            }
        };

        const deleteSaved = async (item, event) => {
            try {
                if (event) event.stopPropagation();
                const res = await BackgroundBridge.deleteTranscript(item.id);
                if (res?.success) {
                    await loadTranscripts();
                }
            } catch (e) {
                console.error('Delete transcript failed:', e);
            }
        };

        const loadToReady = (item) => {
            if (item.status === 'success') {
                transcript.value = item.transcript || '';
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

        const loadTranscripts = async () => {
            try {
                const res = await BackgroundBridge.getTranscripts();
                if (res?.success) {
                    const list = Array.isArray(res.transcripts) ? res.transcripts : [];
                    transcriptsList.value = list;
                    const latestSuccess = list.find(item => item.status === 'success');
                    if (latestSuccess) {
                        transcript.value = latestSuccess.transcript || '';
                    }
                }
            } catch (e) {
                console.warn('Failed to load transcripts:', e);
            }
        };

        // Initialize app
        onMounted(async () => {
            try {
                const data = await chrome.storage.local.get(['user', 'isAuthenticated', 'authToken']);
                if (data.isAuthenticated && data.user && data.authToken) {
                    user.value = data.user;
                    isAuthenticated.value = true;
                }
                await loadTranscripts();
            } catch (error) {
                console.error('Failed to load stored data:', error);
            }
        });

        // Expose methods/state
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
            copiedItemId,
            showTokenWarning,
            fileInput,
            transcriptsList,
            editingId,
            editingText,
            editingFilename,
            // Methods
            signInWithGoogle,
            logout,
            handleFileSelect,
            handleDrop,
            handleDragOver,
            handleDragLeave,
            copyTranscript,
            copySavedTranscript,
            sendToChatGPT,
            resetUpload,
            clearError,
            closeTokenWarning,
            openFileDialog,
            startEdit,
            cancelEdit,
            saveEdit,
            deleteSaved,
            loadToReady,
            updateEditingText,
            updateEditingFilename
        };
    },

    render() {
        const { 
            isAuthenticated, isLoading, user, transcript, isProcessing, 
            processingMessage, error, isDragOver, isCopied, showTokenWarning,
            signInWithGoogle, logout, handleFileSelect, 
            handleDrop, handleDragOver, handleDragLeave, copyTranscript, sendToChatGPT, 
            resetUpload, clearError, closeTokenWarning, openFileDialog, transcriptsList,
            editingId, editingText, editingFilename, startEdit, cancelEdit, saveEdit,
            deleteSaved, copySavedTranscript, copiedItemId, loadToReady,
            updateEditingText, updateEditingFilename
        } = this;

        const renderTranscriptItem = (item) => {
            const statusLabel = item.status === 'pending' ? '⏳' : item.status === 'success' ? '✅' : '❌';
            const isEditing = editingId === item.id;
            const actions = [];
            if (item.status === 'success') {
                if (!isEditing) {
                    actions.push(h('button', { class: 'icon-btn', onClick: (e) => copySavedTranscript(item, e) }, copiedItemId === item.id ? '✓ Copied' : '📋 Copy'));
                    actions.push(h('button', { class: 'icon-btn', onClick: (e) => startEdit(item, e) }, '✏️ Edit'));
                } else {
                    actions.push(h('button', { class: 'icon-btn primary', onClick: (e) => saveEdit(e) }, '💾 Save'));
                    actions.push(h('button', { class: 'icon-btn secondary', onClick: (e) => cancelEdit(e) }, '↩️ Cancel'));
                }
            }
            actions.push(h('button', { class: 'icon-btn danger', onClick: (e) => deleteSaved(item, e) }, '🗑️ Delete'));

            const headerChildren = [];
            if (item.status === 'pending') {
                headerChildren.push(h('span', { class: 'inline-spinner', 'aria-label': 'Loading' }));
            }
            headerChildren.push(h('span', { class: 'filename-text' }, `${statusLabel} ${item.filename}`));

            return h('div', { class: 'saved-item', onClick: () => loadToReady(item) }, [
                h('div', { class: 'saved-item-top' }, [
                    h('div', { class: 'saved-item-header' }, headerChildren),
                    h('div', { class: 'saved-item-actions' }, actions)
                ]),
                item.status === 'pending' && h('div', { class: 'pending-note' }, 'Processing… Please don’t close your browser'),
                item.status === 'success' && (!isEditing ? h('textarea', {
                    class: 'saved-item-text',
                    readonly: true,
                    value: item.transcript || ''
                }) : h('div', { class: 'saved-edit-form', onClick: (e) => e.stopPropagation() }, [
                    h('input', {
                        class: 'saved-item-filename',
                        value: editingFilename,
                        onInput: updateEditingFilename,
                        placeholder: 'Filename'
                    }),
                    h('textarea', {
                        class: 'saved-item-text editable',
                        value: editingText,
                        onInput: updateEditingText
                    })
                ])),
                item.status === 'error' && h('div', { class: 'saved-item-error' }, item.error || 'Error'),
                h('div', { class: 'saved-item-footer' }, new Date(item.createdAt).toLocaleString())
            ]);
        };

        return h('div', [
            // Header
            h('div', { class: 'header' }, [
                h('img', { src: 'icons/icon32.png', alt: 'Open AudioAi', class: 'logo' }),
                h('h1', 'Open AudioAi')
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
                    h('div', { class: 'user-profile' }, [
                        h('img', { src: user.picture, alt: user.name, class: 'user-avatar' }),
                        h('div', { class: 'user-details' }, [
                            h('span', { class: 'user-name' }, user.name),
                            h('div', { class: 'email-row' }, [
                                h('span', { class: 'user-email' }, user.email)
                            ])
                        ])
                    ]),
                    h('button', { class: 'logout-btn', onClick: logout, title: 'Log out', 'aria-label': 'Log out' }, [
                        h('svg', {
                            xmlns: 'http://www.w3.org/2000/svg',
                            viewBox: '0 0 24 24',
                            fill: 'none',
                            stroke: 'currentColor',
                            'stroke-width': '1.8',
                            'stroke-linecap': 'round',
                            'stroke-linejoin': 'round',
                            width: '20',
                            height: '20',
                            class: 'logout-svg'
                        }, [
                            h('path', { d: 'M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6A2.25 2.25 0 0 0 5.25 5.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15' }),
                            h('path', { d: 'M18 12H8.25' }),
                            h('path', { d: 'M15 9l3 3-3 3' })
                        ])
                    ])
                ]),

                // Upload section
                h('div', { class: 'upload-section' }, [
                    // Upload area
                    !transcript && h('div', {
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

                    // Transcript display
                    transcript && h('div', { class: 'transcript-section' }, [
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
                    ]),

                    // Saved transcripts list
                    h('div', { class: 'saved-section' }, [
                        h('h3', 'Saved Transcripts'),
                        transcriptsList.length === 0 && h('p', { class: 'empty' }, 'No transcripts yet.'),
                        transcriptsList.length > 0 && h('div', { class: 'saved-list' }, transcriptsList.map(renderTranscriptItem))
                    ])
                ])
            ]),

            // Token Warning Modal
            showTokenWarning && h('div', {
                class: 'modal-overlay',
                onClick: closeTokenWarning
            }, [
                h('div', {
                    class: 'modal-content',
                    onClick: (e) => e.stopPropagation()
                }, [
                    h('div', { class: 'modal-header' }, [
                        h('h3', 'Insufficient Tokens'),
                        h('button', {
                            class: 'close-btn',
                            onClick: closeTokenWarning
                        }, '×')
                    ]),
                    h('div', { class: 'modal-body' }, [
                        h('p', "You don't have enough tokens to process this audio file. Please check your account balance or upgrade your plan.")
                    ]),
                    h('div', { class: 'modal-footer' }, [
                        h('button', {
                            class: 'modal-btn',
                            onClick: closeTokenWarning
                        }, 'Understood')
                    ])
                ])
            ])
        ]);
    }
};

createApp(App).mount('#app');