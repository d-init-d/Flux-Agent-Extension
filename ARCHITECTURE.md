# 🏛️ Flux Agent Extension - Architecture

> System architecture diagrams and data flow documentation

---

## 🔷 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CHROME BROWSER                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐                              ┌─────────────────────┐  │
│  │                 │                              │                     │  │
│  │   WEB PAGE      │◄────── Content Script ──────►│    SIDEBAR PANEL    │  │
│  │                 │         (Injected)           │     (React App)     │  │
│  │  ┌───────────┐  │                              │                     │  │
│  │  │   DOM     │  │                              │  ┌───────────────┐  │  │
│  │  │Controller │  │                              │  │  Chat UI      │  │  │
│  │  └───────────┘  │                              │  │  Settings     │  │  │
│  │                 │                              │  │  Actions      │  │  │
│  └────────┬────────┘                              │  └───────────────┘  │  │
│           │                                       │          │          │  │
│           │                                       └──────────┼──────────┘  │
│           │                                                  │             │
│           │         ┌────────────────────────────┐          │             │
│           │         │                            │          │             │
│           └────────►│   BACKGROUND SERVICE       │◄─────────┘             │
│                     │      WORKER                │                        │
│                     │                            │                        │
│                     │  ┌──────────────────────┐  │                        │
│                     │  │    Message Hub       │  │                        │
│                     │  ├──────────────────────┤  │                        │
│                     │  │    AI Providers      │  │                        │
│                     │  ├──────────────────────┤  │                        │
│                     │  │    Agent Logic       │  │                        │
│                     │  ├──────────────────────┤  │                        │
│                     │  │    Auth Manager      │  │                        │
│                     │  └──────────────────────┘  │                        │
│                     │              │             │                        │
│                     └──────────────┼─────────────┘                        │
│                                    │                                       │
└────────────────────────────────────┼───────────────────────────────────────┘
                                     │
                                     ▼
                    ┌────────────────────────────────┐
                    │       EXTERNAL SERVICES        │
                    ├────────────────────────────────┤
                    │  • Anthropic Claude API        │
                    │  • OpenAI API                  │
                    │  • Google Gemini API           │
                    │  • Google OAuth                │
                    │  • Local Ollama                │
                    └────────────────────────────────┘
```

---

## 🔄 Message Flow Architecture

### 1. User Chat → AI Response

```
┌──────────┐    ┌────────────┐    ┌───────────────┐    ┌──────────────┐
│  User    │    │  Sidebar   │    │  Background   │    │  AI Provider │
│  Input   │    │   (React)  │    │  (Service SW) │    │   (Claude)   │
└────┬─────┘    └─────┬──────┘    └───────┬───────┘    └──────┬───────┘
     │                │                   │                   │
     │  Type message  │                   │                   │
     │───────────────►│                   │                   │
     │                │                   │                   │
     │                │  CHAT_SEND        │                   │
     │                │──────────────────►│                   │
     │                │                   │                   │
     │                │                   │  API Request      │
     │                │                   │──────────────────►│
     │                │                   │                   │
     │                │                   │  Stream Response  │
     │                │  CHAT_STREAM      │◄──────────────────│
     │                │◄──────────────────│                   │
     │                │                   │                   │
     │  Display msg   │                   │                   │
     │◄───────────────│                   │                   │
     │                │                   │                   │
```

### 2. AI Action → DOM Manipulation

```
┌───────────────┐    ┌────────────┐    ┌───────────────┐    ┌───────────┐
│  AI Provider  │    │ Background │    │Content Script │    │   DOM     │
│  (Claude)     │    │ (Agent)    │    │(DOM Controller│    │  (Page)   │
└───────┬───────┘    └─────┬──────┘    └───────┬───────┘    └─────┬─────┘
        │                  │                   │                  │
        │  Tool Call:      │                   │                  │
        │  click("button") │                   │                  │
        │─────────────────►│                   │                  │
        │                  │                   │                  │
        │                  │  DOM_ACTION       │                  │
        │                  │  {action: click}  │                  │
        │                  │──────────────────►│                  │
        │                  │                   │                  │
        │                  │                   │  Find element    │
        │                  │                   │─────────────────►│
        │                  │                   │                  │
        │                  │                   │  Click element   │
        │                  │                   │─────────────────►│
        │                  │                   │                  │
        │                  │                   │  Screenshot      │
        │                  │                   │◄─────────────────│
        │                  │                   │                  │
        │                  │  ACTION_RESULT    │                  │
        │                  │  {success, screenshot}               │
        │  Tool Result     │◄──────────────────│                  │
        │◄─────────────────│                   │                  │
        │                  │                   │                  │
```

---

## 📦 Module Dependencies

```
                         ┌─────────────────┐
                         │     SHARED      │
                         │  types, utils   │
                         │   constants     │
                         └────────┬────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
          ▼                       ▼                       ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    SIDEBAR      │     │   BACKGROUND    │     │    CONTENT      │
│                 │     │                 │     │                 │
│  - React App    │     │  - Message Hub  │     │  - DOM Control  │
│  - UI Components│◄───►│  - AI Providers │◄───►│  - Actions      │
│  - State Store  │     │  - Agent Logic  │     │  - Highlighter  │
│  - Hooks        │     │  - Auth         │     │  - Selectors    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
          │                       │                       │
          │                       ▼                       │
          │             ┌─────────────────┐              │
          │             │     AGENT       │              │
          │             │                 │              │
          └────────────►│  - Planner      │◄─────────────┘
                        │  - Executor     │
                        │  - Tools        │
                        │  - Prompts      │
                        └─────────────────┘
```

---

## 🔐 Security Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      SECURITY LAYERS                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   PERMISSION LAYER                       │   │
│  │  • Minimal permissions requested                        │   │
│  │  • activeTab instead of <all_urls> where possible       │   │
│  │  • User consent for sensitive actions                   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    DATA LAYER                            │   │
│  │  • API keys encrypted in chrome.storage.local           │   │
│  │  • No sensitive data in chrome.storage.sync             │   │
│  │  • Tokens refreshed automatically                        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                  NETWORK LAYER                           │   │
│  │  • HTTPS only for API calls                             │   │
│  │  • No logging of sensitive data                         │   │
│  │  • Rate limiting to prevent abuse                       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                 CONTENT SCRIPT LAYER                     │   │
│  │  • Isolated world execution                             │   │
│  │  • No eval() or innerHTML with user content             │   │
│  │  • CSP compliance                                       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🤖 AI Provider Architecture

```
                    ┌───────────────────────────────┐
                    │       Provider Registry       │
                    │   (Manages all providers)     │
                    └───────────────┬───────────────┘
                                    │
         ┌──────────────────────────┼──────────────────────────┐
         │                          │                          │
         ▼                          ▼                          ▼
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│  Claude Provider│       │ OpenAI Provider │       │ Gemini Provider │
├─────────────────┤       ├─────────────────┤       ├─────────────────┤
│ • chat()        │       │ • chat()        │       │ • chat()        │
│ • chatStream()  │       │ • chatStream()  │       │ • chatStream()  │
│ • callWithTools │       │ • callWithTools │       │ • callWithTools │
│ • vision ✓      │       │ • vision ✓      │       │ • vision ✓      │
└─────────────────┘       └─────────────────┘       └─────────────────┘
         │                          │                          │
         │                          │                          │
         ▼                          ▼                          ▼
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│ Ollama Provider │       │GoogleAI Provider│       │ Custom Provider │
├─────────────────┤       ├─────────────────┤       ├─────────────────┤
│ • chat()        │       │ • OAuth Flow    │       │ • Implement     │
│ • chatStream()  │       │ • chat()        │       │   BaseProvider  │
│ • local model   │       │ • Google Account│       │   interface     │
│ • no vision     │       │ • Rate limits   │       │                 │
└─────────────────┘       └─────────────────┘       └─────────────────┘

                    ┌───────────────────────────────┐
                    │      BaseProvider Interface   │
                    ├───────────────────────────────┤
                    │ + configure(config)           │
                    │ + isConfigured(): boolean     │
                    │ + chat(messages): Response    │
                    │ + chatStream(messages): Async │
                    │ + callWithTools(msg, tools)   │
                    │ + supportsVision(): boolean   │
                    └───────────────────────────────┘
```

---

## 🎯 Agent Execution Flow

```
┌───────────────────────────────────────────────────────────────────────┐
│                        AGENT EXECUTION FLOW                           │
└───────────────────────────────────────────────────────────────────────┘

User: "Fill out the contact form with my info and submit"
                          │
                          ▼
            ┌─────────────────────────┐
            │    1. PARSE REQUEST     │
            │    Understanding intent │
            └────────────┬────────────┘
                         │
                         ▼
            ┌─────────────────────────┐
            │   2. GET PAGE CONTEXT   │
            │   Screenshot + DOM info │
            └────────────┬────────────┘
                         │
                         ▼
            ┌─────────────────────────┐
            │    3. PLAN ACTIONS      │
            │    AI creates step list │
            └────────────┬────────────┘
                         │
                         ▼
        ┌────────────────────────────────────┐
        │           ACTION PLAN              │
        ├────────────────────────────────────┤
        │ 1. click("Name input field")       │
        │ 2. type("John Doe")                │
        │ 3. click("Email input field")      │
        │ 4. type("john@example.com")        │
        │ 5. click("Submit button")          │
        └────────────────┬───────────────────┘
                         │
                         ▼
            ┌─────────────────────────┐
            │  4. CONFIRM WITH USER   │──────► User: "Proceed" / "Cancel"
            │  Show plan, ask consent │
            └────────────┬────────────┘
                         │ (if approved)
                         ▼
            ┌─────────────────────────┐
            │   5. EXECUTE ACTIONS    │
            │   One by one with logs  │◄─────┐
            └────────────┬────────────┘      │
                         │                   │
                         ▼                   │
            ┌─────────────────────────┐      │
            │  6. VERIFY & CONTINUE   │      │
            │  Check result, next step│──────┘
            └────────────┬────────────┘
                         │
                         ▼
            ┌─────────────────────────┐
            │   7. REPORT COMPLETION  │
            │   Summary to user       │
            └─────────────────────────┘
```

---

## 📱 Sidebar UI Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     SIDEBAR PANEL                           │
│                    (400px width)                            │
├─────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ HEADER                                           [⚙️][X] │ │
│ │ Flux Agent          [Provider: Claude ▼]                │ │
│ └─────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────┐ │
│ │                                                         │ │
│ │ MESSAGE LIST                                    (scroll)│ │
│ │                                                         │ │
│ │ ┌───────────────────────────────────┐                  │ │
│ │ │ 🤖 AI: Hello! I can help you...   │                  │ │
│ │ └───────────────────────────────────┘                  │ │
│ │                                                         │ │
│ │                  ┌───────────────────────────────────┐ │ │
│ │                  │ 👤 User: Fill the form please    │ │ │
│ │                  └───────────────────────────────────┘ │ │
│ │                                                         │ │
│ │ ┌───────────────────────────────────┐                  │ │
│ │ │ 🤖 AI: I'll help you fill...      │                  │ │
│ │ │                                   │                  │ │
│ │ │ ┌───────────────────────────────┐ │                  │ │
│ │ │ │ ACTION PREVIEW                │ │                  │ │
│ │ │ │ ✓ Click name field            │ │                  │ │
│ │ │ │ ○ Type "John Doe"             │ │                  │ │
│ │ │ │ ○ Click email field           │ │                  │ │
│ │ │ │ [Execute] [Cancel]            │ │                  │ │
│ │ │ └───────────────────────────────┘ │                  │ │
│ │ └───────────────────────────────────┘                  │ │
│ │                                                         │ │
│ │ ┌─────────────────────────┐                            │ │
│ │ │ ⏳ Typing...            │                            │ │
│ │ └─────────────────────────┘                            │ │
│ │                                                         │ │
│ └─────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ INPUT AREA                                              │ │
│ │ ┌─────────────────────────────────────────────────┐ [➤]│ │
│ │ │ Type your message...                            │    │ │
│ │ └─────────────────────────────────────────────────┘    │ │
│ │ [📷 Screenshot] [📋 Page Info] [⌨️ Quick Actions]      │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## 🗄️ Data Storage Schema

```typescript
// chrome.storage.local structure

interface StorageSchema {
  // Settings
  settings: {
    theme: 'light' | 'dark' | 'system';
    defaultProvider: string;
    autoScreenshot: boolean;
    confirmActions: boolean;
    language: string;
  };
  
  // Provider configurations
  providers: {
    [providerId: string]: {
      apiKey?: string; // encrypted
      baseUrl?: string;
      model?: string;
      maxTokens?: number;
      temperature?: number;
    };
  };
  
  // Google OAuth tokens
  googleTokens?: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  };
  
  // Chat history (optional)
  chatHistory?: {
    [sessionId: string]: {
      messages: Message[];
      createdAt: number;
      updatedAt: number;
    };
  };
  
  // Action history
  actionHistory?: {
    id: string;
    action: string;
    params: unknown;
    result: ActionResult;
    timestamp: number;
  }[];
}
```

---

## 🚀 Performance Considerations

| Area | Strategy | Target |
|------|----------|--------|
| Bundle Size | Code splitting, tree shaking | < 500KB |
| Initial Load | Lazy load sidebar components | < 500ms |
| Message Passing | Batch messages, debounce | < 50ms latency |
| Screenshots | Compress to JPEG, resize | < 500KB/image |
| Memory | Clear old chat history | < 50MB usage |
| Content Script | Minimal footprint | < 1MB heap |

---

*Last Updated: 2025-02-03*
