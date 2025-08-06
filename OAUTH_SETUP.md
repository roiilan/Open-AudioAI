# 🔧 Fix Google OAuth Setup - מדריך תיקון אימות Google

## בעיה נוכחית
השגיאה שאתה מקבל:
```
OAuth2 request failed: Service responded with error: 'bad client id: 174350614321-jbjk9v1hgfs9c08iaj0pngrv2tj4m8ct.apps.googleusercontent.com'
```

זה קורה כי ה-Client ID שמוגדר במערכת אינו תקין או לא הוגדר כראוי ב-Google Cloud Console.

## פתרון מהיר 🚀

### שלב 1: יצירת פרויקט ב-Google Cloud Console
1. לך ל-[Google Cloud Console](https://console.cloud.google.com/)
2. צור פרויקט חדש או בחר פרויקט קיים
3. רשום את שם הפרויקט

### שלב 2: הפעלת APIs נדרשים
1. בחר את הפרויקט
2. לך ל-"APIs & Services" > "Library"
3. חפש והפעל את ה-APIs הבאים:
   - **Google+ API** (או Google People API)
   - **Google OAuth2 API**

### שלב 3: הגדרת OAuth Consent Screen
1. לך ל-"APIs & Services" > "OAuth consent screen"
2. בחר "External" (אלא אם יש לך G Suite domain)
3. מלא פרטים:
   - **App name**: "Open AudioAi"
   - **User support email**: המייל שלך
   - **Developer contact**: המייל שלך
4. בשלב "Scopes" הוסף:
   - `email`
   - `profile` 
   - `openid`

### שלב 4: יצירת OAuth Client ID
1. לך ל-"APIs & Services" > "Credentials"
2. לחץ "Create Credentials" > "OAuth 2.0 Client IDs"
3. בחר Application type: **"Chrome Extension"**
4. **חשוב**: אתה תצטרך להוסיף את ה-Extension ID אחרי שתטען את התוסף
5. העתק את ה-Client ID שנוצר

### שלב 5: עדכון התוסף
1. פתח את הקובץ `manifest.json`
2. החלף את השורה:
   ```json
   "client_id": "YOUR_GOOGLE_CLIENT_ID_HERE.apps.googleusercontent.com"
   ```
   עם ה-Client ID האמיתי שלך:
   ```json
   "client_id": "THE_ACTUAL_CLIENT_ID_YOU_COPIED.apps.googleusercontent.com"
   ```

### שלב 6: קבלת Extension ID
1. פתח Chrome
2. לך ל-`chrome://extensions/`
3. הפעל "Developer mode" (למעלה ימינה)
4. לחץ "Load unpacked" וטען את התיקיה של התוסף
5. העתק את ה-Extension ID שמופיע

### שלב 7: עדכון ב-Google Cloud Console
1. חזור ל-Google Cloud Console > Credentials
2. לחץ על ה-OAuth client שיצרת
3. ב-"Authorized redirect URIs" הוסף:
   ```
   chrome-extension://YOUR_EXTENSION_ID_HERE/
   ```
4. החלף `YOUR_EXTENSION_ID_HERE` עם ה-ID האמיתי
5. שמור

### שלב 8: בדיקה
1. טען מחדש את התוסף ב-Chrome
2. פתח את ה-popup
3. נסה להיכנס עם Google

## פתרון בעיות נוספות

### אם עדיין מקבל שגיאות:
1. ודא שה-OAuth consent screen מאושר
2. בדק שהתוסף נטען מהתיקיה הנכונה
3. נסה להסיר ולהוסיף מחדש את התוסף
4. בדק שה-Client ID נשמר נכון (ללא רווחים או תווים מיותרים)

### אם השגיאה "invalid_client":
- ודא שה-Extension ID ב-Google Console תואם למה שמופיע ב-Chrome
- בדק שה-OAuth client מוגדר כ-"Chrome Extension" ולא כ-"Web application"

### לבדיקת חיבור:
יש בקונסול של הדפדפן (F12) לראות הודעות debug. אם הכל תקין, תראה:
```
Authentication successful
User info retrieved: {email: "...", name: "..."}
```

## קבצים שצריך לערוך:
- ✅ `manifest.json` - עדכן Client ID
- ⚠️ אם יש, בדק גם בקבצים אחרים שמכילים את ה-Client ID

---
**הערה חשובה**: לאחר כל שינוי ב-`manifest.json`, יש לטעון מחדש את התוסף ב-Chrome דרך `chrome://extensions/`