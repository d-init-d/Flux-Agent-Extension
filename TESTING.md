# Testing Strategy Document

> **Project:** AI Browser Controller - Chrome Extension (Manifest V3)  
> **Version:** 1.0.0  
> **Last Updated:** 2026-03-05  
> **Maintainer:** QA Team

---

## Table of Contents

1. [Testing Pyramid](#1-testing-pyramid)
2. [Unit Testing Strategy](#2-unit-testing-strategy)
3. [Integration Testing](#3-integration-testing)
4. [E2E Testing](#4-e2e-testing)
5. [Critical Test Cases](#5-critical-test-cases)
6. [Test Automation](#6-test-automation)
7. [Browser Compatibility](#7-browser-compatibility)
8. [Performance Testing](#8-performance-testing)
9. [Testing Tools & Setup](#9-testing-tools--setup)
10. [QA Checklist](#10-qa-checklist)

---

## 1. Testing Pyramid

```
                    ┌─────────────┐
                    │   Manual    │  5%   - Exploratory, UX validation
                    │   Testing   │
                   ─┴─────────────┴─
                  ┌─────────────────┐
                  │   E2E Tests     │  15%  - Full user flows
                  │                 │
                 ─┴─────────────────┴─
                ┌─────────────────────┐
                │  Integration Tests  │  30%  - Component communication
                │                     │
               ─┴─────────────────────┴─
              ┌─────────────────────────┐
              │      Unit Tests         │  50%  - Individual functions
              │                         │
             ─┴─────────────────────────┴─
```

### Distribution Strategy

| Layer | Coverage Target | Run Frequency | Execution Time |
|-------|----------------|---------------|----------------|
| Unit Tests | 80%+ | Every commit | < 30 seconds |
| Integration | 70%+ | Every PR | < 2 minutes |
| E2E | Critical paths 100% | Pre-release | < 10 minutes |
| Manual | Risk-based | Release cycle | Variable |

---

## 2. Unit Testing Strategy

### 2.1 AI Client Module

**Location:** `src/ai/client.ts`

#### What to Test

| Function | Test Focus |
|----------|------------|
| `sendMessage()` | Request formatting, response parsing |
| `handleStream()` | Streaming response chunks, buffer management |
| `parseCommand()` | AI response → structured command extraction |
| `handleError()` | Error classification, retry logic |
| `rateLimit()` | Throttling, queue management |

#### Test Cases

```typescript
// ai-client.test.ts
describe('AIClient', () => {
  describe('sendMessage', () => {
    it('should format request with correct headers', async () => {
      const mockFetch = vi.fn().mockResolvedValue(mockResponse);
      const client = new AIClient({ fetch: mockFetch });
      
      await client.sendMessage('Navigate to google.com');
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': expect.stringMatching(/^Bearer /),
          }),
        })
      );
    });

    it('should timeout after configured duration', async () => {
      const slowFetch = vi.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 10000))
      );
      const client = new AIClient({ fetch: slowFetch, timeout: 100 });
      
      await expect(client.sendMessage('test')).rejects.toThrow('Timeout');
    });

    it('should retry on 429 rate limit error', async () => {
      const mockFetch = vi.fn()
        .mockRejectedValueOnce({ status: 429, headers: { 'Retry-After': '1' } })
        .mockResolvedValueOnce(mockResponse);
      
      const client = new AIClient({ fetch: mockFetch, maxRetries: 3 });
      await client.sendMessage('test');
      
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('parseCommand', () => {
    it('should extract CLICK command with selector', () => {
      const response = 'I will click the button. [ACTION: CLICK selector="#submit"]';
      const command = parseCommand(response);
      
      expect(command).toEqual({
        action: 'CLICK',
        params: { selector: '#submit' },
      });
    });

    it('should handle malformed AI response gracefully', () => {
      const response = 'I cannot understand this request.';
      const command = parseCommand(response);
      
      expect(command).toEqual({ action: 'NONE', params: {} });
    });

    it('should extract multiple commands from response', () => {
      const response = `
        [ACTION: NAVIGATE url="https://example.com"]
        [ACTION: WAIT duration="1000"]
        [ACTION: CLICK selector="button"]
      `;
      const commands = parseCommands(response);
      
      expect(commands).toHaveLength(3);
    });
  });
});
```

#### Mocking Strategy

```typescript
// __mocks__/ai-api.ts
export const mockAIResponse = (content: string) => ({
  ok: true,
  json: async () => ({
    choices: [{ message: { content } }],
  }),
});

export const mockStreamResponse = (chunks: string[]) => ({
  ok: true,
  body: {
    getReader: () => ({
      read: vi.fn()
        .mockResolvedValueOnce({ value: encode(chunks[0]), done: false })
        .mockResolvedValueOnce({ value: encode(chunks[1]), done: false })
        .mockResolvedValueOnce({ done: true }),
    }),
  },
});
```

#### Edge Cases

- [ ] Empty response from AI
- [ ] Response with invalid JSON
- [ ] Network disconnection mid-stream
- [ ] API key rotation during request
- [ ] Response exceeding max tokens
- [ ] Unicode/emoji in commands
- [ ] Nested quotes in selectors

---

### 2.2 Command Parser Module

**Location:** `src/parser/command-parser.ts`

#### What to Test

| Function | Test Focus |
|----------|------------|
| `parse()` | Command extraction from various formats |
| `validate()` | Parameter validation, required fields |
| `sanitize()` | XSS prevention, injection protection |
| `normalize()` | Consistent output format |

#### Test Cases

```typescript
describe('CommandParser', () => {
  describe('parse', () => {
    const validCommands = [
      { input: 'CLICK #btn', expected: { action: 'CLICK', selector: '#btn' } },
      { input: 'FILL input[name="email"] "test@test.com"', 
        expected: { action: 'FILL', selector: 'input[name="email"]', value: 'test@test.com' } },
      { input: 'NAVIGATE https://google.com', 
        expected: { action: 'NAVIGATE', url: 'https://google.com' } },
      { input: 'SCREENSHOT', expected: { action: 'SCREENSHOT' } },
      { input: 'WAIT 1000', expected: { action: 'WAIT', duration: 1000 } },
      { input: 'SCROLL down 500', expected: { action: 'SCROLL', direction: 'down', amount: 500 } },
    ];

    it.each(validCommands)('should parse: $input', ({ input, expected }) => {
      expect(CommandParser.parse(input)).toMatchObject(expected);
    });
  });

  describe('validate', () => {
    it('should reject CLICK without selector', () => {
      expect(() => CommandParser.validate({ action: 'CLICK' }))
        .toThrow('CLICK requires selector');
    });

    it('should reject NAVIGATE with invalid URL', () => {
      expect(() => CommandParser.validate({ action: 'NAVIGATE', url: 'not-a-url' }))
        .toThrow('Invalid URL');
    });

    it('should reject FILL without value', () => {
      expect(() => CommandParser.validate({ action: 'FILL', selector: '#input' }))
        .toThrow('FILL requires value');
    });
  });

  describe('sanitize', () => {
    it('should escape XSS in selector', () => {
      const malicious = 'div[onclick="alert(1)"]';
      const sanitized = CommandParser.sanitize(malicious);
      expect(sanitized).not.toContain('onclick');
    });

    it('should prevent javascript: URLs', () => {
      const command = { action: 'NAVIGATE', url: 'javascript:alert(1)' };
      expect(() => CommandParser.validate(command)).toThrow('Forbidden URL scheme');
    });
  });
});
```

---

### 2.3 Browser Controller Module

**Location:** `src/controller/browser-controller.ts`

#### What to Test

| Function | Test Focus |
|----------|------------|
| `executeClick()` | Element selection, click dispatch |
| `executeFill()` | Input value setting, event triggers |
| `executeNavigate()` | Tab management, URL validation |
| `executeScreenshot()` | Capture API, format conversion |
| `executeScroll()` | Viewport manipulation |
| `executeWait()` | Timer accuracy |

#### Mocking Strategy (Chrome APIs)

```typescript
// __mocks__/chrome.ts
export const chrome = {
  tabs: {
    query: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    sendMessage: vi.fn(),
    captureVisibleTab: vi.fn(),
  },
  scripting: {
    executeScript: vi.fn(),
  },
  runtime: {
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    lastError: null,
  },
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
    },
    sync: {
      get: vi.fn(),
      set: vi.fn(),
    },
  },
};

// Setup in test file
beforeEach(() => {
  vi.stubGlobal('chrome', chrome);
});
```

#### Test Cases

```typescript
describe('BrowserController', () => {
  describe('executeClick', () => {
    it('should click element via content script', async () => {
      chrome.tabs.query.mockResolvedValue([{ id: 1 }]);
      chrome.tabs.sendMessage.mockResolvedValue({ success: true });

      const result = await BrowserController.executeClick('#submit');

      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, {
        action: 'CLICK',
        selector: '#submit',
      });
      expect(result.success).toBe(true);
    });

    it('should handle element not found', async () => {
      chrome.tabs.query.mockResolvedValue([{ id: 1 }]);
      chrome.tabs.sendMessage.mockResolvedValue({ 
        success: false, 
        error: 'Element not found' 
      });

      const result = await BrowserController.executeClick('#nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Element not found');
    });

    it('should handle no active tab', async () => {
      chrome.tabs.query.mockResolvedValue([]);

      await expect(BrowserController.executeClick('#btn'))
        .rejects.toThrow('No active tab');
    });
  });

  describe('executeScreenshot', () => {
    it('should capture visible tab as PNG', async () => {
      const mockDataUrl = 'data:image/png;base64,abc123';
      chrome.tabs.captureVisibleTab.mockResolvedValue(mockDataUrl);

      const result = await BrowserController.executeScreenshot();

      expect(result.dataUrl).toBe(mockDataUrl);
      expect(result.format).toBe('png');
    });

    it('should handle capture permission error', async () => {
      chrome.tabs.captureVisibleTab.mockRejectedValue(
        new Error('Cannot capture this page')
      );

      await expect(BrowserController.executeScreenshot())
        .rejects.toThrow('Cannot capture this page');
    });
  });
});
```

---

### 2.4 Content Script Bridge

**Location:** `src/content/bridge.ts`

#### What to Test

| Function | Test Focus |
|----------|------------|
| `handleMessage()` | Message routing, response |
| `findElement()` | DOM querying, multiple strategies |
| `performAction()` | DOM manipulation |
| `reportResult()` | Result serialization |

#### Test Cases

```typescript
describe('ContentScriptBridge', () => {
  let mockDocument: Document;

  beforeEach(() => {
    mockDocument = new JSDOM(`
      <html>
        <body>
          <button id="submit">Submit</button>
          <input name="email" type="text" />
          <div class="container">
            <span data-testid="label">Hello</span>
          </div>
        </body>
      </html>
    `).window.document;
    
    vi.stubGlobal('document', mockDocument);
  });

  describe('findElement', () => {
    it('should find by ID selector', () => {
      const element = ContentBridge.findElement('#submit');
      expect(element?.tagName).toBe('BUTTON');
    });

    it('should find by attribute selector', () => {
      const element = ContentBridge.findElement('[data-testid="label"]');
      expect(element?.textContent).toBe('Hello');
    });

    it('should find by text content', () => {
      const element = ContentBridge.findElement('text=Submit');
      expect(element?.id).toBe('submit');
    });

    it('should return null for non-existent element', () => {
      const element = ContentBridge.findElement('#nonexistent');
      expect(element).toBeNull();
    });

    it('should handle iframe elements', () => {
      // Add iframe to mock document
      const iframe = mockDocument.createElement('iframe');
      iframe.id = 'nested-frame';
      mockDocument.body.appendChild(iframe);

      const element = ContentBridge.findElement('#nested-frame >> #inner-btn');
      // Should handle cross-frame querying
    });
  });

  describe('performAction', () => {
    it('should dispatch click event', () => {
      const button = mockDocument.querySelector('#submit');
      const clickSpy = vi.fn();
      button?.addEventListener('click', clickSpy);

      ContentBridge.performAction({ action: 'CLICK', selector: '#submit' });

      expect(clickSpy).toHaveBeenCalled();
    });

    it('should set input value and dispatch events', () => {
      const input = mockDocument.querySelector('input[name="email"]') as HTMLInputElement;
      const inputSpy = vi.fn();
      const changeSpy = vi.fn();
      input.addEventListener('input', inputSpy);
      input.addEventListener('change', changeSpy);

      ContentBridge.performAction({ 
        action: 'FILL', 
        selector: 'input[name="email"]', 
        value: 'test@example.com' 
      });

      expect(input.value).toBe('test@example.com');
      expect(inputSpy).toHaveBeenCalled();
      expect(changeSpy).toHaveBeenCalled();
    });
  });
});
```

---

### 2.5 Storage/State Manager

**Location:** `src/storage/state-manager.ts`

#### What to Test

| Function | Test Focus |
|----------|------------|
| `saveState()` | Persistence, serialization |
| `loadState()` | Deserialization, migration |
| `clearState()` | Cleanup |
| `migrateState()` | Version compatibility |

#### Test Cases

```typescript
describe('StateManager', () => {
  beforeEach(() => {
    chrome.storage.local.get.mockReset();
    chrome.storage.local.set.mockReset();
  });

  describe('saveState', () => {
    it('should persist state to chrome.storage.local', async () => {
      chrome.storage.local.set.mockResolvedValue(undefined);

      await StateManager.saveState({ 
        history: [{ command: 'CLICK #btn', timestamp: Date.now() }],
        settings: { autoExecute: true },
      });

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        state: expect.objectContaining({
          history: expect.any(Array),
          settings: expect.any(Object),
          version: expect.any(String),
        }),
      });
    });

    it('should handle storage quota exceeded', async () => {
      chrome.storage.local.set.mockRejectedValue(
        new Error('QUOTA_BYTES_PER_ITEM quota exceeded')
      );

      await expect(StateManager.saveState({ large: 'x'.repeat(1000000) }))
        .rejects.toThrow('Storage quota exceeded');
    });
  });

  describe('loadState', () => {
    it('should return default state when empty', async () => {
      chrome.storage.local.get.mockResolvedValue({});

      const state = await StateManager.loadState();

      expect(state).toEqual(StateManager.DEFAULT_STATE);
    });

    it('should migrate old state versions', async () => {
      chrome.storage.local.get.mockResolvedValue({
        state: {
          version: '0.9.0',
          oldFormat: true, // Old field
        },
      });

      const state = await StateManager.loadState();

      expect(state.version).toBe(StateManager.CURRENT_VERSION);
      expect(state.oldFormat).toBeUndefined();
      expect(state.newFormat).toBeDefined(); // Migrated field
    });
  });
});
```

#### Coverage Targets

| Module | Line Coverage | Branch Coverage | Function Coverage |
|--------|--------------|-----------------|-------------------|
| AI Client | 85% | 80% | 90% |
| Command Parser | 90% | 85% | 95% |
| Browser Controller | 80% | 75% | 85% |
| Content Bridge | 85% | 80% | 90% |
| State Manager | 90% | 85% | 95% |

---

## 3. Integration Testing

### 3.1 Service Worker ↔ Content Script Communication

```typescript
// integration/sw-content.test.ts
describe('Service Worker ↔ Content Script', () => {
  let serviceWorker: ServiceWorkerMock;
  let contentScript: ContentScriptMock;

  beforeEach(async () => {
    serviceWorker = await startServiceWorker();
    contentScript = await injectContentScript(testPage);
  });

  it('should relay CLICK command from SW to CS and receive result', async () => {
    // SW sends command
    const promise = serviceWorker.sendToContent({
      action: 'CLICK',
      selector: '#test-button',
    });

    // CS processes and responds
    const result = await promise;

    expect(result).toEqual({
      success: true,
      element: { tagName: 'BUTTON', id: 'test-button' },
    });
  });

  it('should handle content script not loaded scenario', async () => {
    // Navigate to restricted page where CS can't inject
    await chrome.tabs.update(tabId, { url: 'chrome://extensions' });

    const result = await serviceWorker.sendToContent({
      action: 'CLICK',
      selector: '#any',
    });

    expect(result).toEqual({
      success: false,
      error: 'Content script not available on this page',
    });
  });

  it('should handle message timeout', async () => {
    contentScript.setResponseDelay(10000); // Simulate slow page

    const promise = serviceWorker.sendToContent(
      { action: 'CLICK', selector: '#btn' },
      { timeout: 1000 }
    );

    await expect(promise).rejects.toThrow('Message timeout');
  });

  it('should handle concurrent messages correctly', async () => {
    const results = await Promise.all([
      serviceWorker.sendToContent({ action: 'CLICK', selector: '#btn1' }),
      serviceWorker.sendToContent({ action: 'CLICK', selector: '#btn2' }),
      serviceWorker.sendToContent({ action: 'FILL', selector: '#input', value: 'test' }),
    ]);

    expect(results).toHaveLength(3);
    expect(results.every(r => r.success)).toBe(true);
  });
});
```

### 3.2 Extension ↔ AI API Integration

```typescript
// integration/ai-api.test.ts
describe('Extension ↔ AI API', () => {
  let extension: ExtensionContext;
  let aiServer: MockAIServer;

  beforeAll(async () => {
    aiServer = await startMockAIServer(3001);
    extension = await loadExtension({ 
      aiEndpoint: 'http://localhost:3001/v1/chat/completions' 
    });
  });

  afterAll(async () => {
    await aiServer.close();
    await extension.unload();
  });

  it('should send page context to AI and receive command', async () => {
    // Setup: navigate to test page
    await extension.navigateTo('http://localhost:3000/form-page.html');

    // User input
    aiServer.setResponse('Please fill the email field with test@example.com');

    const result = await extension.processUserInput('Fill in my email');

    expect(aiServer.getLastRequest().messages).toContainEqual(
      expect.objectContaining({
        role: 'user',
        content: expect.stringContaining('Fill in my email'),
      })
    );

    expect(result.commandsExecuted).toContainEqual({
      action: 'FILL',
      selector: expect.any(String),
      value: 'test@example.com',
    });
  });

  it('should handle AI API errors gracefully', async () => {
    aiServer.setError(500, 'Internal Server Error');

    const result = await extension.processUserInput('Do something');

    expect(result.success).toBe(false);
    expect(result.error).toContain('AI service unavailable');
    expect(extension.getUI().errorMessage).toBe('AI service unavailable. Please try again.');
  });

  it('should handle streaming responses', async () => {
    const chunks = [
      'I will ',
      'click the ',
      'submit button.',
      '\n[ACTION: CLICK selector="#submit"]',
    ];
    aiServer.setStreamResponse(chunks);

    const events: string[] = [];
    await extension.processUserInput('Click submit', {
      onChunk: (chunk) => events.push(chunk),
    });

    expect(events).toEqual(chunks);
  });
});
```

### 3.3 Storage Operations

```typescript
// integration/storage.test.ts
describe('Storage Integration', () => {
  let extension: ExtensionContext;

  beforeEach(async () => {
    extension = await loadExtension();
    await extension.clearStorage();
  });

  it('should persist history across extension restarts', async () => {
    // Execute some commands
    await extension.executeCommand({ action: 'NAVIGATE', url: 'https://example.com' });
    await extension.executeCommand({ action: 'CLICK', selector: '#btn' });

    // Simulate extension restart
    await extension.reload();

    const history = await extension.getHistory();
    expect(history).toHaveLength(2);
    expect(history[0].action).toBe('NAVIGATE');
    expect(history[1].action).toBe('CLICK');
  });

  it('should sync settings across devices (chrome.storage.sync)', async () => {
    await extension.updateSettings({ theme: 'dark', autoExecute: false });

    // Read from sync storage
    const syncedSettings = await chrome.storage.sync.get('settings');

    expect(syncedSettings.settings).toEqual({
      theme: 'dark',
      autoExecute: false,
    });
  });

  it('should handle storage migration on version update', async () => {
    // Inject old format data
    await chrome.storage.local.set({
      state: {
        version: '0.8.0',
        commands: ['old', 'format'], // Old field name
      },
    });

    // Update extension (triggers migration)
    await extension.reload();

    const state = await extension.getState();
    expect(state.version).toBe('1.0.0');
    expect(state.history).toEqual(['old', 'format']); // Migrated field
    expect(state.commands).toBeUndefined(); // Old field removed
  });
});
```

### 3.4 Cross-Component Workflows

```typescript
// integration/workflows.test.ts
describe('Cross-Component Workflows', () => {
  describe('Full Command Execution Flow', () => {
    it('should process: User Input → AI → Parse → Execute → Result', async () => {
      const extension = await loadExtension();
      const mockAI = await setupMockAI();
      
      // Navigate to form page
      await extension.navigateTo('http://localhost:3000/login.html');
      
      // Mock AI response
      mockAI.respondWith(`
        I'll help you login. 
        [ACTION: FILL selector="#email" value="user@test.com"]
        [ACTION: FILL selector="#password" value="secret123"]
        [ACTION: CLICK selector="#submit"]
      `);

      // User input through popup
      const popup = await extension.openPopup();
      await popup.type('#user-input', 'Login with test credentials');
      await popup.click('#send-btn');

      // Wait for execution
      await popup.waitForSelector('.result-success');

      // Verify all actions executed
      const page = await extension.getActivePage();
      expect(await page.$eval('#email', el => el.value)).toBe('user@test.com');
      expect(await page.$eval('#password', el => el.value)).toBe('secret123');
      
      // Check final state (e.g., redirect after login)
      expect(page.url()).toContain('/dashboard');
    });
  });

  describe('Error Recovery Flow', () => {
    it('should retry failed actions and report to user', async () => {
      const extension = await loadExtension();
      
      // First click fails (element not ready)
      await extension.navigateTo('http://localhost:3000/delayed-button.html');
      
      const result = await extension.executeCommand({
        action: 'CLICK',
        selector: '#delayed-btn',
        retries: 3,
        retryDelay: 500,
      });

      expect(result.attempts).toBeGreaterThan(1);
      expect(result.success).toBe(true);
    });
  });
});
```

---

## 4. E2E Testing

### 4.1 Testing Tools for Chrome Extensions

| Tool | Purpose | Why Choose |
|------|---------|------------|
| **Playwright** | Primary E2E framework | Native extension support, fast, reliable |
| **Puppeteer** | Alternative E2E | Good Chrome DevTools Protocol integration |
| **Selenium** | Legacy support | If needed for older Chrome versions |

### 4.2 Playwright Extension Setup

```typescript
// e2e/setup.ts
import { chromium, type BrowserContext } from 'playwright';
import path from 'path';

export async function createExtensionContext(): Promise<BrowserContext> {
  const extensionPath = path.resolve(__dirname, '../dist');
  
  const context = await chromium.launchPersistentContext('', {
    headless: false, // Extensions require headed mode
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
    ],
  });

  // Wait for service worker to be ready
  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker');
  }

  return context;
}

export async function getExtensionId(context: BrowserContext): Promise<string> {
  const serviceWorker = context.serviceWorkers()[0];
  const url = serviceWorker.url();
  const match = url.match(/chrome-extension:\/\/([^/]+)/);
  return match![1];
}

export async function openExtensionPopup(
  context: BrowserContext, 
  extensionId: string
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  return page;
}
```

### 4.3 E2E Test Scenarios

#### Navigation Tests

```typescript
// e2e/navigation.test.ts
import { test, expect } from '@playwright/test';
import { createExtensionContext, openExtensionPopup, getExtensionId } from './setup';

test.describe('Navigation Tests', () => {
  let context: BrowserContext;
  let extensionId: string;
  let popup: Page;

  test.beforeAll(async () => {
    context = await createExtensionContext();
    extensionId = await getExtensionId(context);
  });

  test.afterAll(async () => {
    await context.close();
  });

  test.beforeEach(async () => {
    popup = await openExtensionPopup(context, extensionId);
  });

  test('should navigate to URL via AI command', async () => {
    // Open a test page
    const page = await context.newPage();
    await page.goto('about:blank');

    // Send command through popup
    await popup.fill('#command-input', 'Go to https://example.com');
    await popup.click('#execute-btn');

    // Wait for navigation
    await page.waitForURL('https://example.com/');
    expect(page.url()).toBe('https://example.com/');
  });

  test('should handle navigation to invalid URL', async () => {
    await popup.fill('#command-input', 'Navigate to not-a-valid-url');
    await popup.click('#execute-btn');

    // Should show error
    await expect(popup.locator('.error-message')).toContainText('Invalid URL');
  });

  test('should navigate back and forward', async () => {
    const page = await context.newPage();
    await page.goto('https://example.com');
    await page.goto('https://example.org');

    await popup.fill('#command-input', 'Go back');
    await popup.click('#execute-btn');

    await page.waitForURL('https://example.com/');
    expect(page.url()).toBe('https://example.com/');
  });
});
```

#### Form Filling Tests

```typescript
// e2e/form-filling.test.ts
test.describe('Form Filling Tests', () => {
  test('should fill text input', async () => {
    const page = await context.newPage();
    await page.goto('http://localhost:3000/form.html');

    await popup.fill('#command-input', 'Fill the email field with test@example.com');
    await popup.click('#execute-btn');

    await expect(page.locator('#email')).toHaveValue('test@example.com');
  });

  test('should fill password field (masked)', async () => {
    const page = await context.newPage();
    await page.goto('http://localhost:3000/login.html');

    await popup.fill('#command-input', 'Enter password secret123');
    await popup.click('#execute-btn');

    const passwordField = page.locator('#password');
    await expect(passwordField).toHaveValue('secret123');
    await expect(passwordField).toHaveAttribute('type', 'password');
  });

  test('should select dropdown option', async () => {
    const page = await context.newPage();
    await page.goto('http://localhost:3000/form.html');

    await popup.fill('#command-input', 'Select "California" from the state dropdown');
    await popup.click('#execute-btn');

    await expect(page.locator('#state')).toHaveValue('CA');
  });

  test('should check checkbox', async () => {
    const page = await context.newPage();
    await page.goto('http://localhost:3000/form.html');

    await popup.fill('#command-input', 'Check the terms agreement checkbox');
    await popup.click('#execute-btn');

    await expect(page.locator('#terms')).toBeChecked();
  });

  test('should handle file upload', async () => {
    const page = await context.newPage();
    await page.goto('http://localhost:3000/upload.html');

    // This requires special handling - AI might not be able to directly upload
    // Test should verify error message or alternative flow
  });
});
```

#### Click/Interaction Tests

```typescript
// e2e/interactions.test.ts
test.describe('Click and Interaction Tests', () => {
  test('should click button by text', async () => {
    const page = await context.newPage();
    await page.goto('http://localhost:3000/buttons.html');

    await popup.fill('#command-input', 'Click the Submit button');
    await popup.click('#execute-btn');

    await expect(page.locator('#result')).toContainText('Submitted!');
  });

  test('should click button by ID', async () => {
    const page = await context.newPage();
    await page.goto('http://localhost:3000/buttons.html');

    await popup.fill('#command-input', 'Click #cancel-btn');
    await popup.click('#execute-btn');

    await expect(page.locator('#result')).toContainText('Cancelled');
  });

  test('should double click element', async () => {
    const page = await context.newPage();
    await page.goto('http://localhost:3000/interactions.html');

    await popup.fill('#command-input', 'Double click on the edit icon');
    await popup.click('#execute-btn');

    await expect(page.locator('#edit-mode')).toBeVisible();
  });

  test('should right click for context menu', async () => {
    const page = await context.newPage();
    await page.goto('http://localhost:3000/context-menu.html');

    await popup.fill('#command-input', 'Right click on the file item');
    await popup.click('#execute-btn');

    await expect(page.locator('.context-menu')).toBeVisible();
  });

  test('should hover over element', async () => {
    const page = await context.newPage();
    await page.goto('http://localhost:3000/tooltips.html');

    await popup.fill('#command-input', 'Hover over the help icon');
    await popup.click('#execute-btn');

    await expect(page.locator('.tooltip')).toBeVisible();
  });
});
```

#### Screenshot Tests

```typescript
// e2e/screenshot.test.ts
test.describe('Screenshot Tests', () => {
  test('should capture full page screenshot', async () => {
    const page = await context.newPage();
    await page.goto('https://example.com');

    await popup.fill('#command-input', 'Take a screenshot');
    await popup.click('#execute-btn');

    // Check screenshot was saved
    await expect(popup.locator('.screenshot-preview')).toBeVisible();
    
    // Verify image data
    const imgSrc = await popup.locator('.screenshot-preview img').getAttribute('src');
    expect(imgSrc).toMatch(/^data:image\/png;base64,/);
  });

  test('should capture element screenshot', async () => {
    const page = await context.newPage();
    await page.goto('http://localhost:3000/dashboard.html');

    await popup.fill('#command-input', 'Screenshot the chart area');
    await popup.click('#execute-btn');

    // Should capture only the chart, not full page
    const imgSrc = await popup.locator('.screenshot-preview img').getAttribute('src');
    // Visual comparison or size check
  });

  test('should handle screenshot on restricted page', async () => {
    const page = await context.newPage();
    await page.goto('chrome://settings');

    await popup.fill('#command-input', 'Take a screenshot');
    await popup.click('#execute-btn');

    await expect(popup.locator('.error-message')).toContainText(
      'Cannot capture screenshot on this page'
    );
  });
});
```

#### Error Handling Tests

```typescript
// e2e/error-handling.test.ts
test.describe('Error Handling Tests', () => {
  test('should handle element not found gracefully', async () => {
    const page = await context.newPage();
    await page.goto('http://localhost:3000/simple.html');

    await popup.fill('#command-input', 'Click #nonexistent-button');
    await popup.click('#execute-btn');

    await expect(popup.locator('.error-message')).toContainText('Element not found');
    // Should suggest alternatives or show page structure
  });

  test('should handle network timeout', async () => {
    // Simulate slow network
    await context.route('**/api/**', (route) => {
      setTimeout(() => route.abort(), 100);
    });

    await popup.fill('#command-input', 'Navigate to https://slow-site.com');
    await popup.click('#execute-btn');

    await expect(popup.locator('.error-message')).toContainText('Navigation timeout');
  });

  test('should handle AI service unavailable', async () => {
    // Mock AI endpoint to return 503
    await context.route('**/v1/chat/completions', (route) => {
      route.fulfill({ status: 503, body: 'Service Unavailable' });
    });

    await popup.fill('#command-input', 'Do something');
    await popup.click('#execute-btn');

    await expect(popup.locator('.error-message')).toContainText('AI service temporarily unavailable');
  });

  test('should handle permission denied', async () => {
    const page = await context.newPage();
    await page.goto('http://localhost:3000/protected.html');

    await popup.fill('#command-input', 'Download the file');
    await popup.click('#execute-btn');

    // Should request permission or show appropriate error
    await expect(popup.locator('.permission-request')).toBeVisible();
  });
});
```

#### Multi-Tab Tests

```typescript
// e2e/multi-tab.test.ts
test.describe('Multi-Tab Tests', () => {
  test('should execute command on active tab only', async () => {
    const page1 = await context.newPage();
    await page1.goto('http://localhost:3000/page1.html');
    
    const page2 = await context.newPage();
    await page2.goto('http://localhost:3000/page2.html');

    // page2 is now active
    await popup.fill('#command-input', 'Click #button');
    await popup.click('#execute-btn');

    // Should only affect page2
    await expect(page2.locator('#result')).toContainText('Clicked');
    await expect(page1.locator('#result')).not.toContainText('Clicked');
  });

  test('should open link in new tab', async () => {
    const page = await context.newPage();
    await page.goto('http://localhost:3000/links.html');

    const tabCountBefore = context.pages().length;

    await popup.fill('#command-input', 'Open the documentation link in a new tab');
    await popup.click('#execute-btn');

    await context.waitForEvent('page');
    expect(context.pages().length).toBe(tabCountBefore + 1);
  });

  test('should switch between tabs', async () => {
    const page1 = await context.newPage();
    await page1.goto('http://localhost:3000/page1.html');
    
    const page2 = await context.newPage();
    await page2.goto('http://localhost:3000/page2.html');

    await popup.fill('#command-input', 'Switch to the first tab');
    await popup.click('#execute-btn');

    // Verify page1 is now focused
    // This may require checking chrome.tabs.query for active tab
  });

  test('should close current tab', async () => {
    const page1 = await context.newPage();
    await page1.goto('http://localhost:3000/page1.html');
    
    const page2 = await context.newPage();
    await page2.goto('http://localhost:3000/page2.html');

    const tabCountBefore = context.pages().length;

    await popup.fill('#command-input', 'Close this tab');
    await popup.click('#execute-btn');

    expect(context.pages().length).toBe(tabCountBefore - 1);
  });
});
```

---

## 5. Critical Test Cases

### 5.1 Happy Path Test Cases

| ID | Scenario | Steps | Expected Result |
|----|----------|-------|-----------------|
| HP-001 | Basic navigation | User says "Go to google.com" | Browser navigates to google.com |
| HP-002 | Form submission | User says "Fill login form and submit" | Form filled and submitted |
| HP-003 | Element click | User says "Click the search button" | Element clicked, action triggered |
| HP-004 | Screenshot capture | User says "Take a screenshot" | Screenshot saved and displayed |
| HP-005 | Page scroll | User says "Scroll down" | Page scrolls down |
| HP-006 | Multi-step workflow | User says "Login, then go to settings" | Both actions completed in sequence |
| HP-007 | Wait for element | User says "Wait for results to load, then click first item" | Waits and clicks |
| HP-008 | Text extraction | User says "What's the price shown?" | Correct text extracted and returned |

### 5.2 Error Scenarios

| ID | Scenario | Trigger | Expected Behavior |
|----|----------|---------|-------------------|
| ER-001 | Element not found | Invalid selector | Clear error message, suggest alternatives |
| ER-002 | Page not responding | Page freeze | Timeout with retry option |
| ER-003 | Network failure | No internet | Offline mode message |
| ER-004 | AI timeout | Slow AI response | Progress indicator, timeout message |
| ER-005 | Invalid command | Malformed AI response | Graceful fallback, ask for clarification |
| ER-006 | Permission denied | Protected page | Explain limitation |
| ER-007 | Content script blocked | CSP restriction | Notify user |
| ER-008 | Rate limit hit | Too many AI requests | Queue requests, show countdown |

### 5.3 Edge Cases

| ID | Scenario | Test Input | Expected |
|----|----------|------------|----------|
| EC-001 | Unicode selectors | `Click #btn-日本語` | Handles correctly |
| EC-002 | Very long text | Fill with 10000 chars | Truncates or scrolls |
| EC-003 | Rapid commands | 10 commands in 1 second | Queue and execute sequentially |
| EC-004 | Empty page | Navigate to about:blank | Handle gracefully |
| EC-005 | Iframe content | Click button inside iframe | Cross-frame execution |
| EC-006 | Shadow DOM | Click inside shadow root | Pierces shadow DOM |
| EC-007 | Dynamic content | Click lazy-loaded element | Wait and retry |
| EC-008 | Multiple matches | Click "Submit" (5 buttons) | Ask for clarification or click first |
| EC-009 | Hidden element | Click display:none button | Report element not interactable |
| EC-010 | Moving element | Click animated button | Wait for animation, then click |

### 5.4 Security Scenarios

| ID | Scenario | Attack Vector | Expected Defense |
|----|----------|---------------|------------------|
| SC-001 | XSS via command | `Click <script>alert(1)</script>` | Sanitize input |
| SC-002 | SQL injection | `Fill #input with "'; DROP TABLE"` | Treat as literal string |
| SC-003 | Javascript URL | `Navigate to javascript:alert(1)` | Block forbidden schemes |
| SC-004 | File access | `Navigate to file:///etc/passwd` | Block file:// URLs |
| SC-005 | Extension page access | `Navigate to chrome-extension://...` | Block internal URLs |
| SC-006 | Data exfiltration | `Read password field` | Mask sensitive data |
| SC-007 | Cookie theft | AI extracts document.cookie | Filter sensitive API access |
| SC-008 | API key exposure | AI tries to access storage | Sanitize AI responses |

### 5.5 Performance Scenarios

| ID | Scenario | Threshold | Test Method |
|----|----------|-----------|-------------|
| PF-001 | Command execution time | < 500ms | Measure from send to complete |
| PF-002 | Popup open time | < 200ms | Time from click to render |
| PF-003 | Service worker startup | < 100ms | Measure cold start |
| PF-004 | Memory usage idle | < 50MB | Check after 1 hour idle |
| PF-005 | Memory usage active | < 150MB | Check during active use |
| PF-006 | CPU during idle | < 1% | Monitor background activity |
| PF-007 | Screenshot speed | < 1s | Full page capture time |
| PF-008 | Large page handling | < 2s response | Page with 10000 elements |

---

## 6. Test Automation

### 6.1 CI/CD Integration (GitHub Actions)

```yaml
# .github/workflows/test.yml
name: Test Suite

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run unit tests
        run: npm run test:unit -- --coverage
      
      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          files: ./coverage/lcov.info
          fail_ci_if_error: true

  integration-tests:
    runs-on: ubuntu-latest
    needs: unit-tests
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Build extension
        run: npm run build
      
      - name: Run integration tests
        run: npm run test:integration

  e2e-tests:
    runs-on: ubuntu-latest
    needs: integration-tests
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Install Playwright browsers
        run: npx playwright install chromium
      
      - name: Build extension
        run: npm run build
      
      - name: Start test server
        run: npm run test:server &
      
      - name: Run E2E tests
        run: npm run test:e2e
      
      - name: Upload test artifacts
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7

  security-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Run security audit
        run: npm audit --production
      
      - name: Run Snyk scan
        uses: snyk/actions/node@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
```

### 6.2 Package.json Scripts

```json
{
  "scripts": {
    "test": "npm run test:unit && npm run test:integration",
    "test:unit": "vitest run --config vitest.config.ts",
    "test:unit:watch": "vitest --config vitest.config.ts",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "test:e2e": "playwright test",
    "test:e2e:headed": "playwright test --headed",
    "test:e2e:debug": "playwright test --debug",
    "test:coverage": "vitest run --coverage",
    "test:server": "node test/fixtures/server.js",
    "test:all": "npm run test:unit && npm run test:integration && npm run test:e2e"
  }
}
```

### 6.3 Test Reporting

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules',
        'test',
        '**/*.d.ts',
        '**/*.test.ts',
      ],
      thresholds: {
        lines: 80,
        branches: 75,
        functions: 85,
        statements: 80,
      },
    },
    reporters: ['verbose', 'html', 'json'],
    outputFile: {
      html: './test-results/index.html',
      json: './test-results/results.json',
    },
  },
});
```

### 6.4 Regression Testing Strategy

```typescript
// test/regression/snapshot.test.ts
import { test, expect } from '@playwright/test';

test.describe('Visual Regression', () => {
  test('popup UI matches snapshot', async ({ page }) => {
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(page).toHaveScreenshot('popup-default.png');
  });

  test('settings page matches snapshot', async ({ page }) => {
    await page.goto(`chrome-extension://${extensionId}/settings.html`);
    await expect(page).toHaveScreenshot('settings-default.png');
  });

  test('error state matches snapshot', async ({ page }) => {
    // Trigger error state
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.fill('#input', 'invalid command');
    await page.click('#execute');
    await expect(page.locator('.error-container')).toHaveScreenshot('error-state.png');
  });
});
```

---

## 7. Browser Compatibility

### 7.1 Chrome Version Support Matrix

| Chrome Version | Support Level | Test Frequency | Notes |
|----------------|---------------|----------------|-------|
| Latest (stable) | Full | Every build | Primary target |
| Latest - 1 | Full | Every PR | Previous stable |
| Latest - 2 | Full | Weekly | Still supported |
| Latest - 3 | Partial | Monthly | Bug fixes only |
| Canary | Experimental | On-demand | Early detection |
| Beta | Monitoring | Weekly | Pre-release validation |

### 7.2 Version-Specific Tests

```typescript
// test/compatibility/chrome-versions.test.ts
const CHROME_VERSIONS = ['120', '121', '122', '123'];

CHROME_VERSIONS.forEach((version) => {
  test.describe(`Chrome ${version} Compatibility`, () => {
    test.use({
      channel: `chrome-${version}`,
    });

    test('manifest v3 APIs available', async ({ context }) => {
      const sw = context.serviceWorkers()[0];
      const result = await sw.evaluate(() => {
        return {
          hasDeclarativeNetRequest: typeof chrome.declarativeNetRequest !== 'undefined',
          hasScripting: typeof chrome.scripting !== 'undefined',
          hasAction: typeof chrome.action !== 'undefined',
        };
      });
      expect(result.hasDeclarativeNetRequest).toBe(true);
      expect(result.hasScripting).toBe(true);
      expect(result.hasAction).toBe(true);
    });

    test('basic functionality works', async ({ page }) => {
      await page.goto('https://example.com');
      // Run basic tests
    });
  });
});
```

### 7.3 Feature Detection

```typescript
// src/utils/feature-detect.ts
export const FeatureDetect = {
  hasOffscreenDocument: () => typeof chrome.offscreen !== 'undefined',
  hasSidePanel: () => typeof chrome.sidePanel !== 'undefined',
  hasUserScripts: () => typeof chrome.userScripts !== 'undefined',
  
  getCapabilities: () => ({
    offscreen: FeatureDetect.hasOffscreenDocument(),
    sidePanel: FeatureDetect.hasSidePanel(),
    userScripts: FeatureDetect.hasUserScripts(),
    chromeVersion: navigator.userAgent.match(/Chrome\/(\d+)/)?.[1],
  }),
};
```

---

## 8. Performance Testing

### 8.1 Memory Leak Detection

```typescript
// test/performance/memory.test.ts
import { test, expect } from '@playwright/test';

test.describe('Memory Leak Detection', () => {
  test('no memory leak after repeated commands', async ({ context }) => {
    const page = await context.newPage();
    await page.goto('http://localhost:3000/test.html');

    const getMemoryUsage = async () => {
      return await page.evaluate(() => {
        if (performance.memory) {
          return performance.memory.usedJSHeapSize;
        }
        return 0;
      });
    };

    const initialMemory = await getMemoryUsage();

    // Execute 100 commands
    for (let i = 0; i < 100; i++) {
      await executeCommand('CLICK #button');
    }

    // Force GC if available
    await page.evaluate(() => {
      if (window.gc) window.gc();
    });

    const finalMemory = await getMemoryUsage();

    // Allow 20% growth max
    expect(finalMemory).toBeLessThan(initialMemory * 1.2);
  });

  test('service worker memory stable over time', async ({ context }) => {
    const sw = context.serviceWorkers()[0];
    
    const measurements: number[] = [];
    
    for (let i = 0; i < 10; i++) {
      const memory = await sw.evaluate(() => {
        // @ts-ignore
        return performance.memory?.usedJSHeapSize ?? 0;
      });
      measurements.push(memory);
      await new Promise(r => setTimeout(r, 1000));
    }

    // Check for consistent growth (leak indicator)
    const growth = measurements[measurements.length - 1] - measurements[0];
    expect(growth).toBeLessThan(5 * 1024 * 1024); // 5MB max growth
  });
});
```

### 8.2 Response Time Benchmarks

```typescript
// test/performance/benchmarks.test.ts
import { test, expect } from '@playwright/test';

test.describe('Performance Benchmarks', () => {
  const THRESHOLDS = {
    commandExecution: 500, // ms
    popupOpen: 200,
    navigationAction: 1000,
    screenshot: 1000,
    aiResponse: 5000,
  };

  test('command execution under 500ms', async ({ page }) => {
    await page.goto('http://localhost:3000/test.html');
    
    const start = Date.now();
    await executeCommand('CLICK #fast-button');
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(THRESHOLDS.commandExecution);
  });

  test('popup opens under 200ms', async ({ context }) => {
    const start = Date.now();
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForSelector('#input');
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(THRESHOLDS.popupOpen);
  });

  test('screenshot capture under 1s', async ({ page }) => {
    await page.goto('https://example.com');
    
    const start = Date.now();
    await executeCommand('SCREENSHOT');
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(THRESHOLDS.screenshot);
  });
});
```

### 8.3 Resource Usage Monitoring

```typescript
// test/performance/resources.test.ts
test.describe('Resource Usage', () => {
  test('CPU usage acceptable during idle', async ({ context }) => {
    // Let extension run idle for 30 seconds
    await new Promise(r => setTimeout(r, 30000));

    const metrics = await context.serviceWorkers()[0].evaluate(() => {
      // Sample CPU usage
      return {
        // Extension-specific metrics
        activeTimers: 0, // Count active intervals/timeouts
        pendingPromises: 0,
      };
    });

    expect(metrics.activeTimers).toBeLessThan(5);
  });

  test('network requests minimized during idle', async ({ context }) => {
    const requests: string[] = [];
    
    context.on('request', (request) => {
      requests.push(request.url());
    });

    // Wait 60 seconds idle
    await new Promise(r => setTimeout(r, 60000));

    // Should not make background requests
    const backgroundRequests = requests.filter(
      url => !url.includes('chrome-extension://')
    );
    expect(backgroundRequests.length).toBeLessThan(5);
  });
});
```

---

## 9. Testing Tools & Setup

### 9.1 Recommended Tool Stack

| Category | Tool | Version | Purpose |
|----------|------|---------|---------|
| Unit Testing | Vitest | ^1.0.0 | Fast, Vite-native test runner |
| E2E Testing | Playwright | ^1.40.0 | Cross-browser automation |
| Mocking | vitest (built-in) | - | Function/module mocking |
| DOM Testing | happy-dom | ^12.0.0 | Fast DOM implementation |
| Coverage | v8 (via Vitest) | - | Code coverage |
| Visual Testing | Playwright Screenshots | - | Visual regression |
| API Mocking | MSW | ^2.0.0 | Network request mocking |
| Performance | Lighthouse CI | ^0.13.0 | Performance audits |

### 9.2 Project Setup

```bash
# Install dependencies
npm install -D vitest @vitest/coverage-v8 happy-dom
npm install -D @playwright/test playwright
npm install -D msw @mswjs/interceptors
npm install -D lighthouse

# Initialize Playwright
npx playwright install chromium
```

### 9.3 Configuration Files

#### vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.ts', 'test/unit/**/*.test.ts'],
    exclude: ['test/e2e/**', 'test/integration/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['**/*.d.ts', '**/*.test.ts'],
    },
    mockReset: true,
    restoreMocks: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@test': resolve(__dirname, 'test'),
    },
  },
});
```

#### playwright.config.ts

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: false, // Extensions need sequential tests
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker for extension tests
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/e2e.json' }],
  ],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        // Extension-specific config handled in tests
      },
    },
  ],
  webServer: {
    command: 'npm run test:server',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
```

#### test/setup.ts

```typescript
import { beforeAll, afterAll, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { handlers } from './mocks/handlers';

// Mock Chrome APIs globally
vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: vi.fn(),
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    lastError: null,
    id: 'test-extension-id',
  },
  tabs: {
    query: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    sendMessage: vi.fn(),
    captureVisibleTab: vi.fn(),
  },
  storage: {
    local: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
    sync: { get: vi.fn(), set: vi.fn() },
  },
  scripting: {
    executeScript: vi.fn(),
  },
  action: {
    setBadgeText: vi.fn(),
    setBadgeBackgroundColor: vi.fn(),
  },
});

// MSW server for API mocking
const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
```

#### test/mocks/handlers.ts

```typescript
import { http, HttpResponse } from 'msw';

export const handlers = [
  // AI API mock
  http.post('*/v1/chat/completions', async ({ request }) => {
    const body = await request.json();
    return HttpResponse.json({
      choices: [{
        message: {
          content: 'Mock AI response: [ACTION: CLICK selector="#test"]',
        },
      }],
    });
  }),

  // Stream response mock
  http.post('*/v1/chat/completions/stream', () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"chunk": "Hello"}\n\n'));
        controller.enqueue(encoder.encode('data: {"chunk": " World"}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    return new HttpResponse(stream, {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }),
];
```

---

## 10. QA Checklist

### 10.1 Pre-Release Checklist

#### Code Quality

- [ ] All unit tests pass (`npm run test:unit`)
- [ ] All integration tests pass (`npm run test:integration`)
- [ ] All E2E tests pass (`npm run test:e2e`)
- [ ] Code coverage meets threshold (80%+ lines)
- [ ] No TypeScript errors (`npx tsc --noEmit`)
- [ ] Linting passes (`npm run lint`)
- [ ] No security vulnerabilities (`npm audit`)

#### Functional Testing

- [ ] Core navigation works
- [ ] Form filling works (text, select, checkbox, radio)
- [ ] Click interactions work
- [ ] Screenshot capture works
- [ ] Multi-tab operations work
- [ ] Error handling displays user-friendly messages
- [ ] Settings persist correctly
- [ ] History/undo works

#### Extension-Specific

- [ ] Manifest version correct
- [ ] Permissions minimal and necessary
- [ ] Content script injects correctly
- [ ] Service worker starts without errors
- [ ] Popup opens and functions
- [ ] Extension icon displays correctly
- [ ] Context menus work (if applicable)
- [ ] Keyboard shortcuts work (if applicable)

#### Performance

- [ ] Popup opens under 200ms
- [ ] Commands execute under 500ms
- [ ] Memory usage under 100MB active
- [ ] No memory leaks detected
- [ ] No excessive CPU usage when idle

#### Security

- [ ] XSS prevention tested
- [ ] URL scheme restrictions enforced
- [ ] Sensitive data not logged
- [ ] API keys not exposed
- [ ] CSP headers respected
- [ ] Permissions appropriately scoped

#### Compatibility

- [ ] Works on Chrome stable
- [ ] Works on Chrome beta
- [ ] Works on Chrome stable - 1
- [ ] Dark mode displays correctly
- [ ] High DPI displays correctly

#### Documentation

- [ ] CHANGELOG updated
- [ ] Version number bumped
- [ ] README accurate
- [ ] API documentation current

### 10.2 Release Sign-Off Template

```markdown
## Release Sign-Off: v{VERSION}

**Date:** {DATE}
**QA Lead:** {NAME}
**Build:** {BUILD_NUMBER}

### Test Results

| Suite | Pass | Fail | Skip | Coverage |
|-------|------|------|------|----------|
| Unit | __ | __ | __ | __% |
| Integration | __ | __ | __ | __% |
| E2E | __ | __ | __ | N/A |

### Critical Paths Verified

- [ ] User can navigate to URL
- [ ] User can fill and submit form
- [ ] User can click elements
- [ ] User can capture screenshot
- [ ] Errors display correctly

### Known Issues

| Issue | Severity | Workaround | Target Fix |
|-------|----------|------------|------------|
| | | | |

### Browser Compatibility

| Browser | Version | Status |
|---------|---------|--------|
| Chrome Stable | __ | ✅/❌ |
| Chrome Beta | __ | ✅/❌ |

### Final Approval

- [ ] **QA Lead approval:** {signature}
- [ ] **Dev Lead approval:** {signature}
- [ ] **Product Owner approval:** {signature}

**Release Status:** APPROVED / BLOCKED
```

---

## Appendix A: Test Data

### Sample Test Pages

Create these HTML files in `test/fixtures/pages/`:

```html
<!-- login.html -->
<!DOCTYPE html>
<html>
<body>
  <form id="login-form">
    <input type="email" id="email" name="email" required>
    <input type="password" id="password" name="password" required>
    <label><input type="checkbox" id="remember"> Remember me</label>
    <button type="submit" id="submit">Login</button>
  </form>
  <div id="result"></div>
  <script>
    document.getElementById('login-form').onsubmit = (e) => {
      e.preventDefault();
      document.getElementById('result').textContent = 'Login submitted!';
    };
  </script>
</body>
</html>
```

```html
<!-- buttons.html -->
<!DOCTYPE html>
<html>
<body>
  <button id="submit-btn" onclick="showResult('Submitted!')">Submit</button>
  <button id="cancel-btn" onclick="showResult('Cancelled')">Cancel</button>
  <button id="delete-btn" class="danger" onclick="showResult('Deleted!')">Delete</button>
  <div id="result"></div>
  <script>
    function showResult(text) {
      document.getElementById('result').textContent = text;
    }
  </script>
</body>
</html>
```

### Test Server

```javascript
// test/fixtures/server.js
const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
  const filePath = path.join(__dirname, 'pages', req.url === '/' ? 'index.html' : req.url);
  
  if (fs.existsSync(filePath)) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(fs.readFileSync(filePath));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(3000, () => console.log('Test server running on http://localhost:3000'));
```

---

## Appendix B: Troubleshooting

### Common Test Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Extension not loading | Path incorrect | Verify `dist` folder exists after build |
| Service worker not found | Build not complete | Run `npm run build` first |
| Tests timeout | Network issues | Check mock server running |
| Flaky E2E tests | Race conditions | Add proper waits, use `waitForSelector` |
| Chrome API undefined | Mock not setup | Verify `test/setup.ts` loaded |
| Coverage too low | Untested code | Check coverage report, add missing tests |

---

*Document maintained by QA Team. Last review: 2026-03-05*
