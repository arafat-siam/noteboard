# Turning on "Share link" (one-time, free)

Shared links are opened by people who don't sign in to Google. To read your public shared
copies, Noteboard needs a Google **API key**. It is public by design (it's in the website code),
so we lock it to your website and to Google Drive only. It costs nothing.

## 1. Enable the Drive API (probably already done)

1. Open https://console.cloud.google.com and pick the Noteboard project (top bar).
2. Left menu → **APIs & Services** → **Enabled APIs & services**.
3. If **Google Drive API** is not in the list: **+ Enable APIs and services** → search
   "Google Drive API" → **Enable**.

## 2. Create the API key

1. Left menu → **APIs & Services** → **Credentials**.
2. **+ Create credentials** → **API key**. A key appears (starts with `AIza…`). Click **Edit API key**
   (or the key's name in the list).
3. **Name**: `Noteboard shared links`.
4. **Application restrictions** → **Websites** → **Add** → `https://arafat-siam.github.io/*`
   → **Done**.
5. **API restrictions** → **Restrict key** → tick **Google Drive API** → **OK**.
6. **Save**. Copy the key.

## 3. Give the key to the website build

1. Open https://github.com/arafat-siam/noteboard → **Settings** → **Secrets and variables** →
   **Actions** → tab **Variables**.
2. **New repository variable** → Name `GOOGLE_API_KEY`, Value: the key → **Add variable**.
3. Tab **Actions** (top of the repository) → the latest run → **Re-run all jobs** (or push any
   change). A few minutes later sharing works.

## How it works

- **Share link** (a notebook's or folder's menu, or Export and more → Share) uploads a read-only
  copy into a "Noteboard shared links" folder in *your* Google Drive and makes only those copies
  viewable by anyone with the link.
- It's a snapshot: later changes aren't included. Share again for a fresh link.
- **Stop sharing** deletes the copy, and the link stops working immediately.
- Locked notebooks are encrypted with their passcode before upload. Without the passcode, the
  shared file is unreadable, even to Google.
