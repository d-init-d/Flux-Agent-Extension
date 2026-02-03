# 🚀 Flux Agent Extension

> AI-powered browser agent that integrates into Chrome sidebar with full web control capabilities

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-green?logo=googlechrome)](https://developer.chrome.com/docs/extensions/)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)](https://developer.chrome.com/docs/extensions/mv3/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61dafb?logo=react)](https://react.dev/)

---

## 🎯 Overview

Flux Agent là một Chrome Extension cho phép bạn:

- 💬 **Chat với AI** trực tiếp trong sidebar
- 👁️ **AI nhìn thấy** trang web bạn đang xem (screenshot + DOM analysis)
- 🤖 **AI điều khiển** trang web như một agent (click, type, scroll, scrape...)
- 🔌 **Multi-provider** - Hỗ trợ Claude, GPT-4, Gemini, Ollama, Google Account

**Inspiration:** [Comet Browser by Perplexity](https://www.perplexity.ai/)

---

## ✨ Features

### Core Features
- [x] Sidebar panel tích hợp Chrome
- [ ] Chat interface với AI
- [ ] Screenshot & page context extraction
- [ ] DOM manipulation actions (click, type, scroll, hover)
- [ ] Data extraction (text, tables, links)
- [ ] Multi-step task execution

### AI Providers
- [ ] Anthropic Claude (API key)
- [ ] OpenAI GPT-4 (API key)
- [ ] Google Gemini (API key)
- [ ] Ollama (local)
- [ ] Google Account (OAuth - custom implementation)

### Advanced
- [ ] Conversation memory
- [ ] Task templates
- [ ] Action history & undo
- [ ] Multi-tab support
- [ ] Automation recipes

---

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   SIDEBAR UI    │◄──►│ BACKGROUND SW    │◄──►│ CONTENT SCRIPT  │
│   (React)       │    │ (Service Worker) │    │ (DOM Controller)│
│                 │    │                  │    │                 │
│ • Chat          │    │ • AI Providers   │    │ • Click/Type    │
│ • Settings      │    │ • Message Hub    │    │ • Screenshot    │
│ • Actions       │    │ • Agent Logic    │    │ • Extract Data  │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed diagrams.

---

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [ROADMAP.md](./ROADMAP.md) | Development phases & timeline |
| [BLUEPRINT.md](./BLUEPRINT.md) | Technical specifications |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System architecture diagrams |

---

## 🛠️ Tech Stack

| Category | Technology |
|----------|------------|
| Build | Vite + CRXJS |
| UI | React 18 + TypeScript |
| Styling | Tailwind CSS |
| State | Zustand |
| AI | Vercel AI SDK |
| Icons | Lucide React |

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- pnpm (recommended) or npm
- Chrome browser

### Installation

```bash
# Clone the repository
git clone https://github.com/d-init-d/Flux-Agent-Extension.git
cd Flux-Agent-Extension

# Install dependencies
pnpm install

# Start development
pnpm dev
```

### Load Extension in Chrome

1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `dist` folder

---

## 📁 Project Structure

```
src/
├── background/          # Service Worker
│   ├── providers/       # AI provider implementations
│   └── auth/            # OAuth handling
├── content/             # Content Script
│   ├── actions/         # DOM actions (click, type, etc.)
│   └── selectors/       # Element finding strategies
├── sidebar/             # React Sidebar App
│   ├── components/      # UI components
│   ├── hooks/           # Custom hooks
│   └── stores/          # Zustand stores
├── agent/               # Agent logic
│   ├── tools/           # Tool definitions
│   └── prompts/         # System prompts
└── shared/              # Shared types & utils
```

---

## 🔐 Security

- API keys encrypted in `chrome.storage.local`
- Minimal permissions requested
- No sensitive data logged
- HTTPS only for API calls
- Content script runs in isolated world

---

## 📄 License

MIT License - See [LICENSE](./LICENSE) for details.

---

## 🤝 Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

---

## 📧 Contact

- GitHub Issues: [Report a bug](https://github.com/d-init-d/Flux-Agent-Extension/issues)

---

*Built with ❤️ by the Flux Agent team*
