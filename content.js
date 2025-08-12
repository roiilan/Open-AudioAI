// Content script for ChatGPT integration
// Security: This script only runs on chat.openai.com and chatgpt.com domains

(function() {
    'use strict';

    // Security: Prevent script injection and ensure we're on the correct domain
    if (!window.location.hostname.includes('openai.com') && !window.location.hostname.includes('chatgpt.com')) {
        return;
    }

    // Utility functions
    const ChatGPTIntegration = {
        // Find the chat input textarea with multiple selectors for robustness
        findChatInput() {
            const selectors = [
                'textarea[placeholder*="Send a message"]',
                'textarea[placeholder*="Message ChatGPT"]',
                'textarea[data-id="root"]',
                'textarea[id*="prompt-textarea"]',
                '#prompt-textarea',
                '[contenteditable="true"][data-id="root"]',
                'div[contenteditable="true"][role="textbox"]'
            ];

            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element && this.isValidInput(element)) {
                    return element;
                }
            }

            return null;
        },

        // Validate that the found element is actually a valid input
        isValidInput(element) {
            if (!element) return false;
            
            // Check if element is visible and not disabled
            const style = window.getComputedStyle(element);
            return style.display !== 'none' && 
                   style.visibility !== 'hidden' && 
                   !element.disabled &&
                   element.offsetParent !== null;
        },

        // Safely insert text into the input
        insertText(element, text) {
            if (!element || !text) return false;

            try {
                // For textarea elements
                if (element.tagName === 'TEXTAREA') {
                    return this.insertIntoTextarea(element, text);
                }
                
                // For contenteditable elements
                if (element.contentEditable === 'true') {
                    return this.insertIntoContentEditable(element, text);
                }

                return false;
            } catch (error) {
                console.error('Error inserting text:', error);
                return false;
            }
        },

        insertIntoTextarea(textarea, text) {
            // Set focus first
            textarea.focus();
            
            // Clear existing content and insert new text
            textarea.value = text;
            
            // Trigger input events to ensure ChatGPT detects the change
            const events = ['input', 'change', 'keyup'];
            events.forEach(eventType => {
                const event = new Event(eventType, { bubbles: true, cancelable: true });
                textarea.dispatchEvent(event);
            });

            // Resize textarea if needed
            if (textarea.style.height) {
                textarea.style.height = 'auto';
                textarea.style.height = textarea.scrollHeight + 'px';
            }

            return true;
        },

        insertIntoContentEditable(element, text) {
            // Set focus first
            element.focus();
            
            // Clear existing content
            element.innerHTML = '';
            
            // Insert text as plain text (security measure)
            const textNode = document.createTextNode(text);
            element.appendChild(textNode);
            
            // Trigger input events
            const events = ['input', 'change', 'keyup'];
            events.forEach(eventType => {
                const event = new Event(eventType, { bubbles: true, cancelable: true });
                element.dispatchEvent(event);
            });

            // Move cursor to end
            const range = document.createRange();
            range.selectNodeContents(element);
            range.collapse(false);
            
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);

            return true;
        },

        // Wait for chat input to be available (useful for SPA navigation)
        waitForChatInput(maxAttempts = 20, interval = 500) {
            return new Promise((resolve) => {
                let attempts = 0;
                
                const checkForInput = () => {
                    const input = this.findChatInput();
                    if (input) {
                        resolve(input);
                        return;
                    }
                    
                    attempts++;
                    if (attempts < maxAttempts) {
                        setTimeout(checkForInput, interval);
                    } else {
                        resolve(null);
                    }
                };
                
                checkForInput();
            });
        },

        // Show notification to user
        showNotification(message, type = 'success') {
            const notification = document.createElement('div');
            notification.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: ${type === 'success' ? '#48bb78' : '#e53e3e'};
                color: white;
                padding: 12px 20px;
                border-radius: 8px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 14px;
                font-weight: 500;
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
                z-index: 10000;
                animation: slideIn 0.3s ease;
            `;

            // Add slide-in animation
            const style = document.createElement('style');
            style.textContent = `
                @keyframes slideIn {
                    from {
                        transform: translateX(100%);
                        opacity: 0;
                    }
                    to {
                        transform: translateX(0);
                        opacity: 1;
                    }
                }
            `;
            document.head.appendChild(style);

            notification.textContent = message;
            document.body.appendChild(notification);

            // Remove notification after 3 seconds
            setTimeout(() => {
                notification.style.animation = 'slideIn 0.3s ease reverse';
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                    if (style.parentNode) {
                        style.parentNode.removeChild(style);
                    }
                }, 300);
            }, 3000);
        }
    };

    // Message listener for extension communication
    chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
        // Security: Validate message source and structure
        if (!sender.id || sender.id !== chrome.runtime.id) {
            console.warn('Unauthorized message source');
            return;
        }

        if (!request.action || typeof request.action !== 'string') {
            console.warn('Invalid message format');
            return;
        }

        try {
            switch (request.action) {
                case 'insertTranscript':
                    await handleInsertTranscript(request.transcript);
                    break;
                
                case 'checkChatAvailable':
                    const input = ChatGPTIntegration.findChatInput();
                    sendResponse({ available: !!input });
                    break;
                
                default:
                    console.warn('Unknown action:', request.action);
            }
        } catch (error) {
            console.error('Error handling message:', error);
            ChatGPTIntegration.showNotification('Error: Unable to process request', 'error');
        }
    });

    // Handle transcript insertion
    async function handleInsertTranscript(transcript) {
        // Security: Validate transcript
        if (!transcript || typeof transcript !== 'string') {
            ChatGPTIntegration.showNotification('Error: Invalid transcript data', 'error');
            return;
        }

        // Sanitize transcript (remove potentially harmful content)
        const sanitizedTranscript = transcript
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<[^>]+>/g, '')
            .trim();

        if (!sanitizedTranscript) {
            ChatGPTIntegration.showNotification('Error: Empty transcript', 'error');
            return;
        }

        // Find chat input
        let chatInput = ChatGPTIntegration.findChatInput();
        
        // If not found, wait for it (handles page loading/navigation)
        if (!chatInput) {
            ChatGPTIntegration.showNotification('Waiting for ChatGPT to load...', 'info');
            chatInput = await ChatGPTIntegration.waitForChatInput();
        }

        if (!chatInput) {
            ChatGPTIntegration.showNotification('Error: Could not find ChatGPT input. Please try again.', 'error');
            return;
        }

        // Prepare transcript without extra prefixes
        const formattedTranscript = sanitizedTranscript;

        // Insert transcript
        const success = ChatGPTIntegration.insertText(chatInput, formattedTranscript);
        
        if (success) {
            ChatGPTIntegration.showNotification('✓ Transcript inserted successfully!', 'success');
        } else {
            ChatGPTIntegration.showNotification('Error: Failed to insert transcript', 'error');
        }
    }

    // Initialize and monitor for page changes (SPA navigation)
    function initializePageMonitoring() {
        let currentUrl = window.location.href;
        
        // Monitor URL changes for SPA navigation
        const observer = new MutationObserver(() => {
            if (window.location.href !== currentUrl) {
                currentUrl = window.location.href;
                // Page changed, small delay to let new page load
                setTimeout(() => {
                    // Re-check if we can find chat input on new page
                    ChatGPTIntegration.findChatInput();
                }, 1000);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializePageMonitoring);
    } else {
        initializePageMonitoring();
    }

    // Console message for debugging (remove in production)
    console.log('Open AudioAi content script loaded on:', window.location.hostname);
})();