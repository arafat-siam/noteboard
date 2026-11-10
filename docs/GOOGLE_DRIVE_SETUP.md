# Google Drive sync setup (one time, free)

Noteboard signs in with Google directly from the browser, so Google needs to know about the app.
This takes about 10 minutes and costs nothing. You only do it once.

## 1. Create a Google Cloud project
1. Open https://console.cloud.google.com/ and sign in with your Google account.
2. At the top, click the project picker → **New Project**. Name: `Noteboard`. Click **Create**, then select it.

## 2. Turn on the Google Drive API
1. Open https://console.cloud.google.com/apis/library/drive.googleapis.com
2. Make sure the `Noteboard` project is selected at the top, then click **Enable**.

## 3. Set up the sign-in screen (OAuth consent)
1. Open https://console.cloud.google.com/auth/overview and click **Get started**.
2. App name: `Noteboard`. User support email: your email. Click **Next**.
3. Audience: **External**. Click **Next**.
4. Contact email: your email. **Next** → agree → **Create**.
5. Go to **Audience** (left menu) → under **Test users** click **Add users** → add your own Gmail address → **Save**.
   (While the app is in "Testing", only test users can sign in. That's fine for personal use.)
6. Go to **Data Access** → **Add or remove scopes** → tick `.../auth/drive.file` → **Update** → **Save**.

## 4. Create the client ID
1. Go to **Clients** (left menu) → **Create client**.
2. Application type: **Web application**. Name: `Noteboard web`.
3. **Authorized JavaScript origins** → Add URI:
   - `https://arafat-siam.github.io`
   - `http://localhost:5173`
4. **Authorized redirect URIs** → Add URI:
   - `https://arafat-siam.github.io/noteboard/`
   - `http://localhost:5173/`
5. Click **Create**. Copy the **Client ID** (looks like `1234…apps.googleusercontent.com`).
   You do **not** need the client secret.

## 5. Give the client ID to the app
1. Open https://github.com/arafat-siam/noteboard/settings/variables/actions
2. **New repository variable**. Name: `GOOGLE_CLIENT_ID`. Value: the client ID. **Add variable**.
3. Re-run the latest CI run (Actions tab → latest run → **Re-run all jobs**) or push any change.

After the deploy, open the app → sidebar → **Connect Google Drive**.
Your notes appear in a `Noteboard` folder in Google Drive.
