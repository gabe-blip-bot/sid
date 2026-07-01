#!/usr/bin/env bash
# Pull the latest Sid changes and remind you to reload the extension.
# Run this from anywhere; it operates on the repo containing this script.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Pulling latest changes..."
git pull

echo
echo "Done. Reload Sid to pick up the changes:"
echo "  - Press Cmd+Shift+U (Ctrl+Shift+U on Windows/Linux) in Chrome, or"
echo "  - Go to chrome://extensions and click Reload on the Sid card."
