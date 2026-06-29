# Google Drive API setup for Sid

Sid can save Markdown files to Google Drive through the Google Drive API.

It creates a Drive folder called:

```text
Sid Context
```

Inside it, Sid writes:

```text
Scratchpad.md
<Project name>.md
```

Each project file includes the current objective, notes, and open tab URLs for the attached Chrome window at save time.

## OAuth setup

1. Load the unpacked extension once from your stable local `sid` folder.
2. Open:

```text
chrome://extensions
```

3. Copy Sid's extension ID.
4. Go to Google Cloud Console.
5. Create or select a project.
6. Enable **Google Drive API**.
7. Go to **Google Auth Platform / Clients**.
8. Create an OAuth client.
9. Application type: **Chrome Extension**.
10. Item ID: paste Sid's Chrome extension ID.
11. Copy the generated client ID.
12. Open `manifest.json` and replace:

```json
"client_id": "PASTE_YOUR_GOOGLE_OAUTH_CLIENT_ID_HERE"
```

13. Reload the extension in Chrome.
14. Open Sid and click **Connect Drive**.

## Scope

Sid uses:

```text
https://www.googleapis.com/auth/drive.file
```

This lets it create and edit files it owns or that you explicitly open/create through the app, rather than full Drive access.
