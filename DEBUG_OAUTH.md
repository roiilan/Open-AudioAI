# 🔍 Debug OAuth Setup - Step by Step

## Your Extension ID: `lnndniljpkjihblappfcacapfokjkjif`

## Step 1: Check Google Cloud Console Settings

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to **APIs & Services** > **Credentials**
3. Find your OAuth 2.0 Client ID: `174350614321-jbjk9v1hgfs9c08iaj0pngrv2tj4m8ct`
4. Click on it to edit

## Step 2: Verify Settings

Check these specific settings:

### Application Type
- **MUST BE**: "Chrome Extension" (not "Web application")

### Authorized Redirect URIs
- **Should contain**: `chrome-extension://lnndniljpkjihblappfcacapfokjkjif/`
- **Note**: The trailing slash `/` is important!

## Step 3: If Settings Are Wrong

### If Application Type is "Web application":
1. You may need to create a NEW OAuth client
2. Choose "Chrome Extension" as the type
3. Set Application ID to: `chrome-extension://lnndniljpkjihblappfcacapfokjkjif/`

### If Redirect URI is missing or wrong:
1. Add: `chrome-extension://lnndniljpkjihblappfcacapfokjkjif/`
2. Save the changes

## Step 4: Test the Fix

1. Reload your extension in Chrome
2. Clear any cached tokens: Go to `chrome://identity-internals/` and remove all tokens
3. Try the sign-in button again

## Expected Result

If everything is configured correctly, you should see:
- OAuth consent screen appears
- User can grant permissions
- Token is returned successfully

## Common Issues

### "bad client id" error usually means:
- Extension ID mismatch between Chrome and Google Console
- Wrong application type (Web app instead of Chrome Extension)
- Missing redirect URI

### Chrome Extensions CAN use Google OAuth
This is a standard, supported feature. The issue is usually configuration, not capability.

## Quick Verification Commands

Open Chrome DevTools console and run:
```javascript
chrome.identity.getAuthToken({interactive: false}, function(token) {
    console.log('Token:', token);
    console.log('Error:', chrome.runtime.lastError);
});
```

This will show if there are any cached tokens or specific error messages.