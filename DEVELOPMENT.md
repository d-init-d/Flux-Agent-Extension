# Flux Agent Extension - Development Guide

## Prerequisites

- Node.js 18+
- pnpm (recommended) or npm
- Chrome browser

## Installation

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev
```

## Load Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select the `dist` folder from this project

## Development

The extension will auto-reload when you make changes to the code.

### Project Structure

```
src/
├── background/      # Service Worker (message hub, AI providers)
├── content/         # Content Script (DOM controller)
├── sidebar/         # React Sidebar App (UI)
└── shared/          # Shared types & utilities
```

## Testing

After loading the extension:

1. Click the extension icon to open the sidebar
2. Try sending a message in the chat
3. Check the console for logs (F12 → Console)

## Troubleshooting

### Extension won't load
- Make sure you ran `pnpm dev` first
- Check that the `dist` folder exists
- Look for errors in `chrome://extensions/`

### Sidebar won't open
- Check the extension is enabled
- Try reloading the extension
- Check browser console for errors

### Messages not working
- Open DevTools (F12)
- Check Console for error messages
- Verify background service worker is running

## Phase 1 Status

- ✅ Vite + React + TypeScript setup
- ✅ Manifest V3 configuration
- ✅ Background service worker with message hub
- ✅ Content script injection
- ✅ Sidebar UI with chat interface
- ✅ Basic message passing

## Next Steps

See [ROADMAP.md](./ROADMAP.md) for upcoming phases.
