# 🔧 Fix Google OAuth Setup - מדריך תיקון אימות Google

## בעיה נוכחית
השגיאה שאתה מקבל:
```
OAuth2 request failed: Service responded with error: 'bad client id: 174350614321-jbjk9v1hgfs9c08iaj0pngrv2tj4m8ct.apps.googleusercontent.com'
```

**הסיבה הסבירה ביותר**: ה-Client ID שלך תקין, אבל ההגדרות ב-Google Cloud Console לא מתאימות לתוסף.

## פתרון מהיר 🚀

### שלב 1: בדוק את ה-Extension ID הנוכחי
1. לך ל-`chrome://extensions/`
2. הפעל "Developer mode" (למעלה ימינה)  
3. טען את התוסף אם הוא לא טעון
4. העתק את ה-Extension ID (זה צריך להתחיל במשהו כמו `abcdefghijk...`)

### שלב 2: עדכן את Google Cloud Console
1. לך ל-[Google Cloud Console](https://console.cloud.google.com/)
2. בחר את הפרויקט הנכון שמכיל את ה-Client ID: `174350614321-jbjk9v1hgfs9c08iaj0pngrv2tj4m8ct`
3. לך ל-"APIs & Services" > "Credentials"
4. מצא את ה-OAuth 2.0 Client ID שלך ולחץ עליו

### שלב 3: ודא שההגדרות נכונות
1. **Application type** צריך להיות: **"Chrome Extension"** (לא Web application!)
2. **Application ID** צריך להיות:
   ```
   chrome-extension://YOUR_EXTENSION_ID_FROM_STEP_1/
   ```
3. אם זה לא נכון - ערוך את ההגדרות

### שלב 4: בדוק OAuth Consent Screen
1. לך ל-"APIs & Services" > "OAuth consent screen"
2. ודא שמוגדרים:
   - **App name**: משהו כמו "Open AudioAi"
   - **User support email**: המייל שלך
   - **Developer contact**: המייל שלך
3. ב-**Scopes** ודא שיש:
   - `email`
   - `profile` 
   - `openid`

### שלב 5: הפעל APIs נדרשים
1. לך ל-"APIs & Services" > "Library"
2. חפש והפעל:
   - **Google+ API** (או Google People API)
   - **Google OAuth2 API**

### שלב 6: בדיקה
1. טען מחדש את התוסף ב-Chrome (`chrome://extensions/` > כפתור refresh)
2. פתח את ה-popup
3. נסה להיכנס עם Google

## פתרון בעיות נוספות

### אם עדיין מקבל "bad client id":
1. **בדוק Extension ID** - ודא שהוא זהה ב-Chrome ובGoogle Console
2. **נסה למחוק Cache** - לך ל-`chrome://identity-internals/` ומחק את כל ה-tokens
3. **בדוק פרויקט** - ודא שאתה עובד על הפרויקט הנכון ב-Google Cloud Console

### אם השגיאה "invalid_client":
- **Client type שגוי** - ודא שנבחר "Chrome Extension" ולא "Web application"
- **Redirect URI** - ודא שזה `chrome-extension://EXTENSION_ID/`

### לבדיקת הגדרות נוכחיות:
1. לך ל-Google Cloud Console > Credentials
2. לחץ על ה-Client ID שלך
3. בדוק שכל הפרטים נכונים:
   - Application type: Chrome Extension ✅
   - Application ID: chrome-extension://[ה-ID הנכון]/ ✅

## זה כנראה יפתור את הבעיה! 🎯

הסיבה הנפוצה ביותר לשגיאה הזו היא שה-Extension ID ב-Google Console לא תואם ל-Extension ID האמיתי ב-Chrome, או שה-Client ID נוצר כ-"Web application" במקום "Chrome Extension".

---
**זכור**: לאחר כל שינוי ב-Google Console או ב-`manifest.json`, טען מחדש את התוסף!