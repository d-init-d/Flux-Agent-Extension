# 📐 Flux Agent Extension - Technical Blueprint

> Detailed technical specifications and implementation guide

---

## 📁 Project Structure

```
flux-agent-extension/
├── manifest.json                 # Chrome Extension Manifest V3
├── package.json                  # Dependencies
├── tsconfig.json                 # TypeScript config
├── vite.config.ts                # Vite build config
├── tailwind.config.js            # Tailwind CSS config
│
├── src/
│   ├── background/               # Service Worker (Background Script)
│   │   ├── index.ts              # Entry point
│   │   ├── message-hub.ts        # Message routing center
│   │   ├── providers/            # AI Provider implementations
│   │   │   ├── index.ts          # Provider registry
│   │   │   ├── base.ts           # Abstract base provider
│   │   │   ├── claude.ts         # Anthropic Claude
│   │   │   ├── openai.ts         # OpenAI GPT-4
│   │   │   ├── gemini.ts         # Google Gemini
│   │   │   ├── ollama.ts         # Local Ollama
│   │   │   └── google-account.ts # Google Account (custom auth)
│   │   ├── auth/                 # Authentication
│   │   │   ├── google-oauth.ts   # Google OAuth flow
│   │   │   └── token-manager.ts  # Token storage & refresh
│   │   └── storage/              # Data persistence
│   │       ├── settings.ts       # User settings
│   │       └── history.ts        # Chat history
│   │
│   ├── content/                  # Content Script (DOM Controller)
│   │   ├── index.ts              # Entry point
│   │   ├── dom-controller.ts     # Main DOM manipulation class
│   │   ├── actions/              # Individual action handlers
│   │   │   ├── index.ts          # Action registry
│   │   │   ├── click.ts          # Click action
│   │   │   ├── type.ts           # Type/input action
│   │   │   ├── scroll.ts         # Scroll action
│   │   │   ├── hover.ts          # Hover action
│   │   │   ├── select.ts         # Dropdown select
│   │   │   ├── extract.ts        # Data extraction
│   │   │   └── screenshot.ts     # Element screenshot
│   │   ├── selectors/            # Element finding strategies
│   │   │   ├── css.ts            # CSS selector
│   │   │   ├── xpath.ts          # XPath selector
│   │   │   ├── text.ts           # Text content match
│   │   │   ├── aria.ts           # ARIA role/label
│   │   │   └── smart.ts          # AI-assisted selector
│   │   ├── highlighter.ts        # Visual feedback overlay
│   │   └── page-context.ts       # Page info extraction
│   │
│   ├── sidebar/                  # Sidebar UI (React App)
│   │   ├── index.html            # HTML entry
│   │   ├── main.tsx              # React entry
│   │   ├── App.tsx               # Root component
│   │   ├── components/           # UI Components
│   │   │   ├── Chat/
│   │   │   │   ├── ChatContainer.tsx
│   │   │   │   ├── MessageList.tsx
│   │   │   │   ├── MessageBubble.tsx
│   │   │   │   ├── InputArea.tsx
│   │   │   │   └── TypingIndicator.tsx
│   │   │   ├── Settings/
│   │   │   │   ├── SettingsPanel.tsx
│   │   │   │   ├── ProviderConfig.tsx
│   │   │   │   └── APIKeyInput.tsx
│   │   │   ├── Actions/
│   │   │   │   ├── ActionPreview.tsx
│   │   │   │   ├── ActionHistory.tsx
│   │   │   │   └── ActionConfirm.tsx
│   │   │   └── Common/
│   │   │       ├── Button.tsx
│   │   │       ├── Input.tsx
│   │   │       ├── Select.tsx
│   │   │       └── Modal.tsx
│   │   ├── hooks/                # Custom React hooks
│   │   │   ├── useChat.ts        # Chat state management
│   │   │   ├── useAgent.ts       # Agent control
│   │   │   ├── useSettings.ts    # Settings access
│   │   │   └── useMessaging.ts   # Chrome messaging
│   │   ├── stores/               # Zustand stores
│   │   │   ├── chatStore.ts      # Chat state
│   │   │   ├── settingsStore.ts  # Settings state
│   │   │   └── agentStore.ts     # Agent state
│   │   └── styles/
│   │       └── globals.css       # Tailwind imports
│   │
│   ├── agent/                    # Agent Logic
│   │   ├── index.ts              # Agent orchestrator
│   │   ├── planner.ts            # Action planning
│   │   ├── executor.ts           # Action execution
│   │   ├── tools/                # Tool definitions for AI
│   │   │   ├── index.ts          # Tool registry
│   │   │   ├── browser-tools.ts  # Browser control tools
│   │   │   ├── data-tools.ts     # Data extraction tools
│   │   │   └── navigation-tools.ts
│   │   └── prompts/              # System prompts
│   │       ├── system.ts         # Base system prompt
│   │       └── templates.ts      # Task-specific prompts
│   │
│   └── shared/                   # Shared utilities
│       ├── types/                # TypeScript types
│       │   ├── index.ts          # Re-exports
│       │   ├── messages.ts       # Message types
│       │   ├── actions.ts        # Action types
│       │   ├── providers.ts      # Provider types
│       │   └── agent.ts          # Agent types
│       ├── constants.ts          # App constants
│       ├── utils.ts              # Utility functions
│       └── logger.ts             # Logging utility
│
├── public/
│   ├── icons/                    # Extension icons
│   │   ├── icon-16.png
│   │   ├── icon-32.png
│   │   ├── icon-48.png
│   │   └── icon-128.png
│   └── _locales/                 # i18n (optional)
│
└── tests/                        # Test files
    ├── unit/
    └── e2e/
```

---

## 🔌 Manifest V3 Configuration

```json
{
  "manifest_version": 3,
  "name": "Flux Agent",
  "version": "1.0.0",
  "description": "AI-powered browser agent with full web control",
  
  "permissions": [
    "activeTab",
    "storage",
    "sidePanel",
    "scripting",
    "tabs",
    "contextMenus"
  ],
  
  "host_permissions": [
    "<all_urls>"
  ],
  
  "background": {
    "service_worker": "src/background/index.ts",
    "type": "module"
  },
  
  "side_panel": {
    "default_path": "src/sidebar/index.html"
  },
  
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["src/content/index.ts"],
      "css": ["src/content/highlighter.css"],
      "run_at": "document_idle"
    }
  ],
  
  "action": {
    "default_title": "Open Flux Agent",
    "default_icon": {
      "16": "public/icons/icon-16.png",
      "32": "public/icons/icon-32.png",
      "48": "public/icons/icon-48.png",
      "128": "public/icons/icon-128.png"
    }
  },
  
  "icons": {
    "16": "public/icons/icon-16.png",
    "32": "public/icons/icon-32.png",
    "48": "public/icons/icon-48.png",
    "128": "public/icons/icon-128.png"
  }
}
```

---

## 📨 Message Protocol

### Message Types

```typescript
// src/shared/types/messages.ts

export type MessageType = 
  // Sidebar → Background
  | 'CHAT_SEND'
  | 'SETTINGS_UPDATE'
  | 'PROVIDER_SWITCH'
  | 'ACTION_EXECUTE'
  | 'ACTION_CANCEL'
  
  // Background → Sidebar
  | 'CHAT_RESPONSE'
  | 'CHAT_STREAM'
  | 'ACTION_STATUS'
  | 'ERROR'
  
  // Background → Content
  | 'DOM_ACTION'
  | 'SCREENSHOT_REQUEST'
  | 'PAGE_CONTEXT_REQUEST'
  
  // Content → Background
  | 'DOM_ACTION_RESULT'
  | 'SCREENSHOT_RESULT'
  | 'PAGE_CONTEXT_RESULT';

export interface Message<T = unknown> {
  type: MessageType;
  payload: T;
  timestamp: number;
  id: string;
}
```

### Message Flow

```
┌─────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   SIDEBAR   │ ──────► │   BACKGROUND     │ ──────► │  CONTENT SCRIPT │
│   (React)   │ ◄────── │ (Service Worker) │ ◄────── │ (DOM Controller)│
└─────────────┘         └──────────────────┘         └─────────────────┘
      │                         │                            │
      │  CHAT_SEND              │  DOM_ACTION                │
      │  ──────────────►        │  ────────────────────►     │
      │                         │                            │
      │                         │  DOM_ACTION_RESULT         │
      │  CHAT_RESPONSE          │  ◄────────────────────     │
      │  ◄──────────────        │                            │
      │                         │                            │
```

---

## 🤖 AI Provider Interface

```typescript
// src/background/providers/base.ts

export interface AIProvider {
  name: string;
  id: string;
  
  // Configuration
  configure(config: ProviderConfig): Promise<void>;
  isConfigured(): boolean;
  
  // Chat
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;
  chatStream(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<ChatChunk>;
  
  // Tool calling
  supportTools(): boolean;
  callWithTools(
    messages: ChatMessage[], 
    tools: Tool[],
    options?: ChatOptions
  ): Promise<ToolCallResponse>;
  
  // Vision
  supportsVision(): boolean;
  chatWithImage(
    messages: ChatMessage[],
    images: ImageData[],
    options?: ChatOptions
  ): Promise<ChatResponse>;
}

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema;
}
```

---

## 🎯 DOM Controller Actions

```typescript
// src/content/dom-controller.ts

export interface DOMController {
  // Element finding
  findElement(selector: ElementSelector): Promise<Element | null>;
  findElements(selector: ElementSelector): Promise<Element[]>;
  
  // Actions
  click(selector: ElementSelector, options?: ClickOptions): Promise<ActionResult>;
  type(selector: ElementSelector, text: string, options?: TypeOptions): Promise<ActionResult>;
  scroll(options: ScrollOptions): Promise<ActionResult>;
  hover(selector: ElementSelector): Promise<ActionResult>;
  select(selector: ElementSelector, value: string): Promise<ActionResult>;
  
  // Data extraction
  extractText(selector: ElementSelector): Promise<string>;
  extractTable(selector: ElementSelector): Promise<TableData>;
  extractLinks(selector?: ElementSelector): Promise<LinkData[]>;
  
  // Screenshots
  screenshotViewport(): Promise<string>; // base64
  screenshotElement(selector: ElementSelector): Promise<string>;
  
  // Page context
  getPageContext(): Promise<PageContext>;
}

export interface ElementSelector {
  type: 'css' | 'xpath' | 'text' | 'aria' | 'smart';
  value: string;
  index?: number; // for multiple matches
}

export interface ActionResult {
  success: boolean;
  message?: string;
  data?: unknown;
  screenshot?: string; // after action screenshot
}

export interface PageContext {
  url: string;
  title: string;
  description?: string;
  headings: string[];
  forms: FormInfo[];
  links: LinkInfo[];
  interactiveElements: InteractiveElement[];
}
```

---

## 🛠️ Agent Tools Definition

```typescript
// src/agent/tools/browser-tools.ts

export const browserTools: Tool[] = [
  {
    name: 'click',
    description: 'Click on an element on the page',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector, text content, or description of the element to click'
        },
        selectorType: {
          type: 'string',
          enum: ['css', 'text', 'aria', 'smart'],
          default: 'smart'
        }
      },
      required: ['selector']
    }
  },
  {
    name: 'type',
    description: 'Type text into an input field',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector or description of the input field'
        },
        text: {
          type: 'string',
          description: 'Text to type into the field'
        },
        clearFirst: {
          type: 'boolean',
          default: true,
          description: 'Whether to clear the field before typing'
        }
      },
      required: ['selector', 'text']
    }
  },
  {
    name: 'scroll',
    description: 'Scroll the page or to a specific element',
    parameters: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          enum: ['up', 'down', 'top', 'bottom', 'element'],
        },
        selector: {
          type: 'string',
          description: 'Element to scroll to (if direction is "element")'
        },
        amount: {
          type: 'number',
          description: 'Pixels to scroll (for up/down)'
        }
      },
      required: ['direction']
    }
  },
  {
    name: 'extract_text',
    description: 'Extract text content from the page or specific element',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector for specific element, or empty for full page'
        }
      }
    }
  },
  {
    name: 'extract_table',
    description: 'Extract table data as structured JSON',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector for the table element'
        }
      },
      required: ['selector']
    }
  },
  {
    name: 'screenshot',
    description: 'Take a screenshot of the current viewport',
    parameters: {
      type: 'object',
      properties: {
        fullPage: {
          type: 'boolean',
          default: false
        }
      }
    }
  },
  {
    name: 'navigate',
    description: 'Navigate to a URL',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to navigate to'
        }
      },
      required: ['url']
    }
  },
  {
    name: 'get_page_info',
    description: 'Get information about the current page',
    parameters: {
      type: 'object',
      properties: {}
    }
  }
];
```

---

## 🔐 Google Account Authentication

```typescript
// src/background/auth/google-oauth.ts

export interface GoogleAuthConfig {
  clientId: string;
  scopes: string[];
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export class GoogleAuthManager {
  private config: GoogleAuthConfig;
  private tokens: GoogleTokens | null = null;
  
  constructor(config: GoogleAuthConfig) {
    this.config = config;
  }
  
  // OAuth flow using chrome.identity
  async authenticate(): Promise<GoogleTokens> {
    const authUrl = this.buildAuthUrl();
    
    // Use chrome.identity.launchWebAuthFlow
    const responseUrl = await chrome.identity.launchWebAuthFlow({
      url: authUrl,
      interactive: true
    });
    
    const code = this.extractCode(responseUrl);
    this.tokens = await this.exchangeCodeForTokens(code);
    
    await this.saveTokens();
    return this.tokens;
  }
  
  async getValidToken(): Promise<string> {
    if (!this.tokens) {
      await this.loadTokens();
    }
    
    if (this.isTokenExpired()) {
      await this.refreshTokens();
    }
    
    return this.tokens!.accessToken;
  }
  
  private async refreshTokens(): Promise<void> {
    // Implement token refresh logic
  }
  
  private async saveTokens(): Promise<void> {
    await chrome.storage.local.set({ 
      googleTokens: this.tokens 
    });
  }
  
  private async loadTokens(): Promise<void> {
    const result = await chrome.storage.local.get('googleTokens');
    this.tokens = result.googleTokens || null;
  }
}
```

---

## 🎨 Sidebar UI Components

### Chat Container

```tsx
// src/sidebar/components/Chat/ChatContainer.tsx

import React from 'react';
import { useChatStore } from '../../stores/chatStore';
import { MessageList } from './MessageList';
import { InputArea } from './InputArea';
import { TypingIndicator } from './TypingIndicator';

export const ChatContainer: React.FC = () => {
  const { messages, isLoading, sendMessage } = useChatStore();
  
  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <h1 className="text-lg font-semibold text-white">Flux Agent</h1>
        <ProviderSelector />
      </div>
      
      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <MessageList messages={messages} />
        {isLoading && <TypingIndicator />}
      </div>
      
      {/* Input */}
      <InputArea onSend={sendMessage} disabled={isLoading} />
    </div>
  );
};
```

### Message Bubble

```tsx
// src/sidebar/components/Chat/MessageBubble.tsx

import React from 'react';
import { Message } from '../../../shared/types';
import { ActionPreview } from '../Actions/ActionPreview';

interface Props {
  message: Message;
}

export const MessageBubble: React.FC<Props> = ({ message }) => {
  const isUser = message.role === 'user';
  
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2 ${
          isUser
            ? 'bg-blue-600 text-white'
            : 'bg-gray-700 text-gray-100'
        }`}
      >
        {/* Text content */}
        <div className="whitespace-pre-wrap">{message.content}</div>
        
        {/* Action preview if present */}
        {message.actions && message.actions.length > 0 && (
          <ActionPreview actions={message.actions} />
        )}
      </div>
    </div>
  );
};
```

---

## 📊 State Management (Zustand)

```typescript
// src/sidebar/stores/chatStore.ts

import { create } from 'zustand';
import { Message, ChatState } from '../../shared/types';

interface ChatStore extends ChatState {
  // State
  messages: Message[];
  isLoading: boolean;
  currentProvider: string;
  
  // Actions
  sendMessage: (content: string) => Promise<void>;
  addMessage: (message: Message) => void;
  clearMessages: () => void;
  setProvider: (providerId: string) => void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  messages: [],
  isLoading: false,
  currentProvider: 'claude',
  
  sendMessage: async (content: string) => {
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: Date.now()
    };
    
    set(state => ({
      messages: [...state.messages, userMessage],
      isLoading: true
    }));
    
    // Send to background
    const response = await chrome.runtime.sendMessage({
      type: 'CHAT_SEND',
      payload: {
        messages: get().messages,
        provider: get().currentProvider
      }
    });
    
    set(state => ({
      messages: [...state.messages, response],
      isLoading: false
    }));
  },
  
  addMessage: (message) => {
    set(state => ({
      messages: [...state.messages, message]
    }));
  },
  
  clearMessages: () => set({ messages: [] }),
  
  setProvider: (providerId) => set({ currentProvider: providerId })
}));
```

---

## 🔧 Build Configuration

```typescript
// vite.config.ts

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@components': path.resolve(__dirname, 'src/sidebar/components')
    }
  },
  build: {
    rollupOptions: {
      input: {
        sidebar: 'src/sidebar/index.html',
        background: 'src/background/index.ts',
        content: 'src/content/index.ts'
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].[hash].js'
      }
    }
  }
});
```

---

## 🧪 Testing Strategy

| Type | Tool | Coverage Target |
|------|------|-----------------|
| Unit Tests | Vitest | 80% |
| Component Tests | React Testing Library | UI components |
| E2E Tests | Playwright | Critical flows |
| Integration | Custom | Message passing |

---

*Last Updated: 2025-02-03*
