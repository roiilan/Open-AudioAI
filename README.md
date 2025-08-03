# Open AudioAi Chrome Extension

A secure Chrome extension that enables ChatGPT users to upload audio files, transcribe them with timestamps, and send transcripts to ChatGPT for deep analysis.

## Features

🔐 **Secure Google OAuth Authentication**
- Sign in with your Google account
- Secure token management with automatic refresh
- No need to re-authenticate on each use

🎵 **Audio File Upload & Transcription**
- Support for multiple audio formats (MP3, WAV, OGG, AAC, M4A, FLAC)
- File size validation (up to 100MB)
- Secure file processing with your Python server

⚡ **Real-time Processing**
- Beautiful loading animations during transcription
- Progress updates and status notifications
- Token usage validation

📋 **Smart Transcript Management**
- Automatic clipboard copy
- One-click ChatGPT integration
- Easy transcript editing and review

🛡️ **Enterprise-Level Security**
- Input sanitization and XSS protection
- Rate limiting and request validation
- Secure communication with encrypted tokens
- CSP compliance and security monitoring

## Installation

### Prerequisites

1. **Python Server**: You need your existing Python transcription server running
2. **Google OAuth**: Set up Google OAuth credentials for the extension
3. **Chrome Browser**: Latest version recommended

### Setup Steps

1. **Download the Extension**
   ```bash
   git clone [repository-url]
   cd open-audioai-extension
   ```

2. **Configure Google OAuth**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select existing one
   - Enable Google+ API
   - Create OAuth 2.0 credentials
   - Add your extension ID to authorized origins
   - Update `manifest.json` with your client ID:
     ```json
     "oauth2": {
       "client_id": "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com"
     }
     ```

3. **Server Configuration**
   - The extension is already configured for local development:
     ```javascript
     baseUrl: 'http://localhost:8000'
     ```
   - Your Python server should run on port 8000 with the `/transcribe` endpoint

4. **Add Extension Icons**
   - Add icon files to the `icons/` directory:
     - `icon16.png` (16x16 pixels)
     - `icon32.png` (32x32 pixels)
     - `icon48.png` (48x48 pixels)
     - `icon128.png` (128x128 pixels)

5. **Load Extension in Chrome**
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" in the top right
   - Click "Load unpacked"
   - Select the extension directory
   - The extension will appear in your toolbar

## Usage

### First Time Setup

1. **Click the Extension Icon** in your Chrome toolbar
2. **Sign in with Google** when prompted
3. **Grant necessary permissions** for the extension to work

### Uploading Audio Files

1. **Open the Extension** by clicking its icon
2. **Drag and drop** an audio file or **click "Choose File"**
3. **Wait for Processing** - you'll see a beautiful wave animation
4. **Review the Transcript** once processing is complete

### ChatGPT Integration

1. **Copy Transcript** - automatically copied to clipboard
2. **Send to ChatGPT** - click the "🚀 Send to ChatGPT" button
3. **Analyze with AI** - the transcript will be inserted into ChatGPT's input

### Error Handling

- **Insufficient Tokens**: You'll see a modal if you don't have enough tokens
- **File Validation**: Invalid files will show appropriate error messages
- **Network Issues**: Automatic retry options for failed uploads

## Security Features

### Authentication Security
- OAuth 2.0 with Google for secure authentication
- Automatic token validation and refresh
- Secure token storage with encryption
- Session timeout after 30 days of inactivity

### Data Protection
- All user inputs are sanitized to prevent XSS attacks
- File type and size validation before upload
- Secure HTTPS-only communication
- No sensitive data stored in plain text

### API Security
- Rate limiting (10 requests per minute per user)
- Request nonce validation
- Authorization header verification
- Extension version tracking for security updates

### Privacy Protection
- No data collection beyond necessary authentication
- User data is cleared on extension uninstall
- Secure communication channels only
- No third-party analytics or tracking

## API Integration

### Expected Python Server Endpoints

#### `POST /transcribe`
Upload audio file for transcription.

**Headers:**
```
Authorization: Bearer <google-oauth-token>
X-Extension-Version: <extension-version>
```

**Body:** FormData with audio file

**Response:**
```json
{
  "code": 1,
  "transcript": "The transcribed text..."
}
```
or
```json
{
  "code": 2,
  "message": "Insufficient tokens"
}
```

#### `GET /health`
Check server health status.

**Response:**
```json
{
  "status": "healthy",
  "version": "1.0.0"
}
```

## Development

### Project Structure
```
open-audioai-extension/
├── manifest.json          # Extension manifest
├── popup.html             # Main popup interface
├── js/
│   └── popup.js           # Vue.js application logic
├── styles/
│   └── popup.css          # Popup styling
├── background.js          # Service worker
├── content.js             # ChatGPT integration
├── content.css            # Content script styles
├── icons/                 # Extension icons
└── README.md             # This file
```

### Technologies Used
- **Vue.js 3** - Reactive frontend framework
- **Chrome Extensions API** - Browser integration
- **Google OAuth 2.0** - Secure authentication
- **CSS3** - Modern styling with animations
- **JavaScript ES6+** - Modern JavaScript features

### Security Best Practices Implemented
- Content Security Policy (CSP) enforcement
- Input validation and sanitization
- Secure token management
- Rate limiting and abuse prevention
- HTTPS-only communication
- Extension isolation

## Troubleshooting

### Common Issues

**Extension won't load:**
- Check that all required files are present
- Verify manifest.json syntax
- Ensure Google OAuth client ID is correct

**Authentication fails:**
- Verify Google Cloud Console setup
- Check OAuth scopes and permissions
- Ensure extension ID is authorized

**File upload fails:**
- Check Python server is running
- Verify server URL configuration
- Check file format and size limits

**ChatGPT integration not working:**
- Ensure you're on chat.openai.com or chatgpt.com
- Check browser permissions
- Try refreshing the ChatGPT page

### Debug Mode

To enable debug logging:
1. Open Chrome DevTools (F12)
2. Go to Console tab
3. Look for "Open AudioAi" messages
4. Check for any error messages

## Security Reporting

If you discover any security vulnerabilities, please report them responsibly:
- **Do not** create public GitHub issues for security vulnerabilities
- Contact the development team directly
- Provide detailed reproduction steps
- Allow time for patching before disclosure

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For support, issues, or feature requests:
- Open an issue on GitHub
- Contact the development team
- Check the troubleshooting section above

## Changelog

### Version 1.0.0
- Initial release
- Google OAuth authentication
- Audio file upload and transcription
- ChatGPT integration
- Comprehensive security features
- Beautiful Vue.js interface