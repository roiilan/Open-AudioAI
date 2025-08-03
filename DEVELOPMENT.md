# Development Configuration - Open AudioAi

## Current Configuration Status ✅

### Authentication
- **Google OAuth Client ID**: `174350614321-jbjk9v1hgfs9c08iaj0pngrv2tj4m8ct.apps.googleusercontent.com` ✅
- **OAuth Scopes**: openid, email, profile ✅

### Server Configuration  
- **Base URL**: `http://localhost:8000` ✅
- **Transcribe Endpoint**: `http://localhost:8000/transcribe` ✅
- **Health Check**: `http://localhost:8000/health` ✅

### Required Python Server Endpoints

#### POST /transcribe
```python
# Expected request headers:
# Authorization: Bearer <google-oauth-token>
# X-Extension-Version: 1.0.0
# Content-Type: multipart/form-data

# Expected response for success:
{
    "code": 1,
    "transcript": "The transcribed audio content..."
}

# Expected response for insufficient tokens:
{
    "code": 2,
    "message": "Insufficient tokens"
}
```

#### GET /health (Optional)
```python
# Expected response:
{
    "status": "healthy",
    "version": "1.0.0"
}
```

## Development Workflow

### 1. Start Python Server
```bash
# Make sure your server runs on localhost:8000
python your_server.py
# or
uvicorn main:app --host 0.0.0.0 --port 8000
```

### 2. Load Extension in Chrome
1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select this directory
5. Note the Extension ID for Google OAuth configuration

### 3. Test Authentication
1. Click extension icon
2. Sign in with Google
3. Verify user data appears

### 4. Test Audio Upload
1. Select or drag audio file
2. Verify upload animation
3. Check transcript appears
4. Test ChatGPT integration

## Security Notes for Development

- Extension allows HTTP requests to localhost for development
- In production, change to HTTPS endpoints
- Rate limiting is set to 10 requests per minute
- All user inputs are sanitized

## Next Steps

1. **Create Icons**: Add proper extension icons (see icons/README.md)
2. **Test Server Integration**: Verify your Python server works with the extension
3. **Google OAuth Setup**: Configure the extension ID in Google Cloud Console
4. **Production Setup**: When ready, change to HTTPS endpoints

## Debug Information

### Extension Logs
- Right-click extension icon → Inspect → Console
- Check for authentication and API errors

### Content Script Logs  
- On ChatGPT page: F12 → Console → Look for "Open AudioAi" messages

### Background Script Logs
- Go to `chrome://extensions/` → Extension details → Inspect views: background page

## Common Issues

### "OAuth Error"
- Verify extension ID is added to Google Cloud Console
- Check client ID in manifest.json

### "Server Connection Failed" 
- Ensure Python server is running on port 8000
- Check CORS configuration on server
- Verify `/transcribe` endpoint exists

### "File Upload Failed"
- Check file format (MP3, WAV, OGG, AAC, M4A, FLAC)
- Verify file size < 100MB
- Check server logs for errors