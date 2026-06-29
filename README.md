# Sid

Sid is a small Chrome side panel extension for keeping browser context close to the work.

It supports:

- project selection per Chrome window
- creating a new project by typing its name
- reattaching a window to an existing project from the project field
- current objective
- project notes
- one shared scratchpad across all windows
- local autosave
- optional Google Drive sync
- Markdown export with open tab URLs

## Local development workflow

1. Keep this folder somewhere stable, for example:

```bash
~/Projects/sid
```

2. Open Chrome:

```text
chrome://extensions
```

3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the `sid` folder.
6. After future file changes, click **Reload** on the extension card.

Do not repeatedly load different downloaded folders if you are using Google OAuth. Keep one stable local folder.

## Optional GitHub workflow

```bash
cd ~/Projects/sid
git init
git add .
git commit -m "Initial Sid extension"
```

Create an empty GitHub repository called `sid`, then:

```bash
git remote add origin git@github.com:YOUR-USERNAME/sid.git
git branch -M main
git push -u origin main
```

After future updates:

```bash
git pull
```

Then reload the extension in Chrome.

## Google Drive

See `GOOGLE_DRIVE_SETUP.md`.
