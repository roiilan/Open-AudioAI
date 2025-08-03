# Open AudioAi - Setup Configuration Guide

This guide will help you configure the Open AudioAi Chrome extension for your environment.

## Pre-Installation Checklist

- [ ] Python transcription server is running and accessible
- [ ] Google Cloud Console project is set up
- [ ] Chrome browser is installed (latest version)
- [ ] Extension icons are prepared (see icons/README.md)

## Step-by-Step Configuration

### 1. Google OAuth Setup

#### Create Google Cloud Project
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the following APIs:
   - Google+ API
   - Google OAuth2 API

#### Configure OAuth Consent Screen
1. Navigate to "OAuth consent screen"
2. Choose "External" user type
3. Fill in application information:
   - App name: "Open AudioAi"
   - User support email: your email
   - Developer contact: your email
4. Add scopes: `email`, `profile`, `openid`
5. Add test users if needed

#### Create OAuth Credentials
1. Go to "Credentials" section
2. Click "Create Credentials" > "OAuth 2.0 Client IDs"
3. Application type: "Chrome Extension"
4. Add your extension ID (get this after loading the extension)
5. Copy the Client ID

### 2. Extension Configuration

#### Update manifest.json
```json
{
  "oauth2": {
    "client_id": "YOUR_ACTUAL_CLIENT_ID.apps.googleusercontent.com",
    "scopes": [
      "openid",
      "email", 
      "profile"
    ]
  }
}
```

#### Update js/popup.js
Find line 43 and replace:
```javascript
// Line 43
baseUrl: 'https://your-actual-server-url.com'
```

#### Update background.js
Find line 247 and replace:
```javascript
// Line 247
const serverUrl = 'https://your-actual-server-url.com';
```

### 3. Server Configuration

Your Python server should have these endpoints:

#### POST /transcribe
- **Purpose**: Process audio file and return transcript
- **Headers**: 
  - `Authorization: Bearer <token>`
  - `X-Extension-Version: 1.0.0`
- **Body**: FormData with audio file
- **Response**:
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

#### GET /health
- **Purpose**: Health check endpoint
- **Response**:
  ```json
  {
    "status": "healthy",
    "version": "1.0.0"
  }
  ```

### 4. Extension Installation

#### Load Unpacked Extension
1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the extension directory
5. Note the Extension ID (starts with letters)

#### Update OAuth Configuration
1. Return to Google Cloud Console
2. Edit your OAuth client
3. Add the Extension ID to authorized origins
4. Save changes

### 5. Testing Configuration

#### Test Authentication
1. Click the extension icon
2. Click "Sign in with Google"
3. Complete OAuth flow
4. Verify user information displays

#### Test Audio Upload
1. Prepare a small audio file (MP3, WAV, etc.)
2. Drag and drop or select file
3. Verify loading animation appears
4. Check for successful transcript

#### Test ChatGPT Integration
1. Navigate to chat.openai.com
2. Upload an audio file in the extension
3. Click "Send to ChatGPT"
4. Verify transcript appears in ChatGPT input

## Configuration Files Summary

Files that need configuration:

1. **manifest.json**
   - Line 16: `client_id`

2. **js/popup.js**
   - Line 43: `baseUrl`

3. **background.js**
   - Line 247: `serverUrl`

4. **icons/** directory
   - Add: icon16.png, icon32.png, icon48.png, icon128.png

## Security Configuration

### Environment Variables (Python Server)
```bash
export GOOGLE_CLIENT_ID="your-client-id"
export ALLOWED_ORIGINS="chrome-extension://your-extension-id"
export JWT_SECRET="your-jwt-secret"
```

### Server CORS Configuration
```python
# Allow requests from your extension
CORS(app, origins=[
    "chrome-extension://your-extension-id",
    "https://chat.openai.com",
    "https://chatgpt.com"
])
```

## Troubleshooting Configuration

### Common Issues

#### "OAuth Error: Invalid Client"
- Check client ID in manifest.json
- Verify extension ID in Google Console
- Ensure OAuth consent screen is configured

#### "Server Connection Failed"
- Verify server URL in popup.js and background.js
- Check server is running and accessible
- Verify CORS configuration

#### "Extension Won't Load"
- Check manifest.json syntax
- Ensure all required files exist
- Check Chrome Developer Console for errors

#### "ChatGPT Integration Not Working"
- Ensure you're on chat.openai.com or chatgpt.com
- Check content script permissions
- Verify Chrome allows content scripts

### Debug Mode

Enable debug logging:
1. Open extension popup
2. Right-click > "Inspect"
3. Check Console tab for error messages
4. Look for network requests in Network tab

## Production Deployment

### Before Publishing

- [ ] All placeholder URLs replaced
- [ ] OAuth properly configured
- [ ] Extension icons added
- [ ] Security audit completed
- [ ] Testing completed on all features
- [ ] Server deployed and stable

### Chrome Web Store

1. Create developer account
2. Pay one-time registration fee
3. Upload extension package
4. Complete store listing
5. Submit for review

## Support Contacts

For configuration help:
- Check the troubleshooting section in README.md
- Review the security audit document
- Contact the development team

---

**Configuration Version**: 1.0.0  
**Last Updated**: December 2024