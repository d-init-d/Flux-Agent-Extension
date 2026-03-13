import type {
  Action,
  RecordedSessionAction,
  Session,
  SessionRecordingExportFormat,
} from '@shared/types';
import { redactPII } from '@shared/security';

export interface SessionRecordingExportArtifact {
  filename: string;
  mimeType: string;
  content: string;
  format: SessionRecordingExportFormat;
}

interface SessionRecordingJsonExport {
  schemaVersion: 1;
  exportedAt: string;
  sessionId: string;
  sessionName: string | null;
  actionCount: number;
  recordingStatus: Session['recording']['status'];
  startedAt: number | null;
  updatedAt: number | null;
  actions: RecordedSessionAction[];
}

export function buildSessionRecordingExportArtifact(
  session: Session,
  format: SessionRecordingExportFormat,
  exportedAt = new Date(),
): SessionRecordingExportArtifact {
  const recording = buildJsonExport(session, exportedAt);
  const filename = buildExportFilename(session, format, exportedAt);

  switch (format) {
    case 'json':
      return {
        filename,
        mimeType: 'application/json',
        content: JSON.stringify(recording, null, 2),
        format,
      };
    case 'playwright':
      return {
        filename,
        mimeType: 'text/javascript',
        content: buildPlaywrightScript(recording),
        format,
      };
    case 'puppeteer':
      return {
        filename,
        mimeType: 'text/javascript',
        content: buildPuppeteerScript(recording),
        format,
      };
  }

  throw new Error(`Unsupported recording export format: ${String(format)}`);
}

function buildJsonExport(session: Session, exportedAt: Date): SessionRecordingJsonExport {
  return sanitizeRecordingExport({
    schemaVersion: 1,
    exportedAt: exportedAt.toISOString(),
    sessionId: session.config.id,
    sessionName: session.config.name?.trim() || null,
    actionCount: session.recording.actions.length,
    recordingStatus: session.recording.status,
    startedAt: session.recording.startedAt,
    updatedAt: session.recording.updatedAt,
    actions: session.recording.actions.map((entry) => annotateRecordedActionRisk({
      action: JSON.parse(JSON.stringify(entry.action)) as Action,
      timestamp: entry.timestamp,
      riskLevel: entry.riskLevel,
      riskReason: entry.riskReason,
    })),
  });
}

function annotateRecordedActionRisk(entry: RecordedSessionAction): RecordedSessionAction {
  if (entry.riskLevel === 'high' || entry.action.type === 'evaluate') {
    return {
      ...entry,
      riskLevel: 'high',
      riskReason: entry.riskReason ?? 'Runs arbitrary page script during replay/export.',
    };
  }

  return {
    ...entry,
    riskLevel: entry.riskLevel ?? 'standard',
  };
}

function sanitizeRecordingExport(
  recording: SessionRecordingJsonExport,
): SessionRecordingJsonExport {
  return JSON.parse(JSON.stringify(recording), (_key, value: unknown) =>
    typeof value === 'string' ? redactPII(value) : value,
  ) as SessionRecordingJsonExport;
}

function buildExportFilename(
  session: Session,
  format: SessionRecordingExportFormat,
  exportedAt: Date,
): string {
  const timestamp = exportedAt.toISOString().replace(/[:.]/g, '-');
  const sessionLabel = sanitizeFilenameSegment(session.config.name?.trim() || session.config.id);
  const extension = format === 'json' ? 'json' : 'js';
  return `recording-${sessionLabel}-${format}-${timestamp}.${extension}`;
}

function sanitizeFilenameSegment(value: string): string {
  const sanitized = value
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return sanitized.length > 0 ? sanitized : 'session';
}

function buildPlaywrightScript(recording: SessionRecordingJsonExport): string {
  const serializedRecording = JSON.stringify(recording, null, 2);
  const wildcardSpecialCharacters = JSON.stringify('\\^$+?.()|{}[]');
  const backslashLiteral = JSON.stringify('\\');
  const escapedBackslashLiteral = JSON.stringify('\\\\');
  const doubleQuoteLiteral = JSON.stringify('"');
  const escapedDoubleQuoteLiteral = JSON.stringify('\\"');

  return `const { chromium } = require('playwright');

const recording = ${serializedRecording};

function wildcardToRegExp(pattern) {
  let escaped = '';
  const specialCharacters = ${wildcardSpecialCharacters};
  for (const character of pattern) {
    if (character === '*') {
      escaped += '.*';
      continue;
    }

    if (specialCharacters.includes(character)) {
      escaped += ${backslashLiteral} + character;
      continue;
    }

    escaped += character;
  }

  return new RegExp('^' + escaped + '$', 'i');
}

function escapeForCssAttribute(value) {
  return value
    .split(${backslashLiteral})
    .join(${escapedBackslashLiteral})
    .split(${doubleQuoteLiteral})
    .join(${escapedDoubleQuoteLiteral});
}

function describeSelector(selector) {
  const parts = [];
  if (selector.testId) parts.push('testId=' + selector.testId);
  if (selector.ariaLabel) parts.push('ariaLabel=' + selector.ariaLabel);
  if (selector.placeholder) parts.push('placeholder=' + selector.placeholder);
  if (selector.role) parts.push('role=' + selector.role);
  if (selector.textExact) parts.push('textExact=' + selector.textExact);
  if (selector.text) parts.push('text=' + selector.text);
  if (selector.css) parts.push('css=' + selector.css);
  if (selector.xpath) parts.push('xpath=' + selector.xpath);
  if (typeof selector.nth === 'number') parts.push('nth=' + selector.nth);
  if (selector.frame?.mode) parts.push('frame=' + selector.frame.mode);
  return parts.join(', ') || 'unknown selector';
}

function getScopeCandidates(page, selector) {
  if (!selector.frame || selector.frame.mode === 'main') {
    return [page];
  }

  const childFrames = page.frames().filter((frame) => frame !== page.mainFrame());
  if (childFrames.length === 0) {
    return [page];
  }

  if (selector.frame.mode === 'url' && selector.frame.urlPattern) {
    const pattern = wildcardToRegExp(selector.frame.urlPattern);
    const matchedFrames = childFrames.filter((frame) => pattern.test(frame.url()));
    if (matchedFrames.length > 0) {
      return matchedFrames;
    }
  }

  if (selector.frame.mode === 'auto' && childFrames.length === 1) {
    return childFrames;
  }

  return childFrames;
}

function buildLocatorCandidates(scope, selector) {
  const candidates = [];

  if (selector.testId) {
    candidates.push(scope.getByTestId(selector.testId));
  }

  if (selector.role && selector.textExact) {
    candidates.push(scope.getByRole(selector.role, { name: selector.textExact, exact: true }));
  }

  if (selector.role && selector.text) {
    candidates.push(scope.getByRole(selector.role, { name: selector.text }));
  }

  if (selector.ariaLabel) {
    candidates.push(scope.locator('[aria-label="' + escapeForCssAttribute(selector.ariaLabel) + '"]'));
    candidates.push(scope.getByLabel(selector.ariaLabel, { exact: true }));
  }

  if (selector.placeholder) {
    candidates.push(scope.getByPlaceholder(selector.placeholder, { exact: true }));
  }

  if (selector.textExact) {
    candidates.push(scope.getByText(selector.textExact, { exact: true }));
  }

  if (selector.text) {
    candidates.push(scope.getByText(selector.text));
  }

  if (selector.css) {
    candidates.push(scope.locator(selector.css));
  }

  if (selector.xpath) {
    candidates.push(scope.locator('xpath=' + selector.xpath));
  }

  return candidates;
}

function applyNth(locator, nth) {
  return typeof nth === 'number' ? locator.nth(nth) : locator;
}

async function resolveLocator(page, selector) {
  const scopes = getScopeCandidates(page, selector);

  for (const scope of scopes) {
    const candidates = buildLocatorCandidates(scope, selector);
    for (const candidate of candidates) {
      const locator = applyNth(candidate, selector.nth);
      if (await locator.count() > 0) {
        return locator;
      }
    }
  }

  throw new Error('Unable to resolve selector: ' + describeSelector(selector));
}

function getDelayMs(actions, index) {
  if (index === 0) {
    return 0;
  }

  return Math.max(0, actions[index].timestamp - actions[index - 1].timestamp);
}

async function runAction(page, recordedAction) {
  const action = recordedAction.action;

  switch (action.type) {
    case 'navigate':
      await page.goto(action.url, {
        waitUntil: action.waitUntil === 'domContentLoaded' ? 'domcontentloaded' : action.waitUntil === 'networkIdle' ? 'networkidle' : 'load',
      });
      return;
    case 'click': {
      const locator = await resolveLocator(page, action.selector);
      await locator.click();
      return;
    }
    case 'fill': {
      const locator = await resolveLocator(page, action.selector);
      await locator.fill(action.value);
      return;
    }
    case 'type': {
      const locator = await resolveLocator(page, action.selector);
      await locator.type(action.text, typeof action.delay === 'number' ? { delay: action.delay } : undefined);
      return;
    }
    case 'evaluate':
      console.warn('High-risk evaluate action in recording export', recordedAction.riskReason || 'Runs arbitrary page script during replay/export.');
      await page.evaluate(
        ({ script, args }) => {
          const run = new Function('args', script);
          return run(args);
        },
        { script: action.script, args: action.args || [] },
      );
      return;
    default:
      throw new Error('Unsupported recorded action type for Playwright export: ' + action.type);
  }
}

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  try {
    for (let index = 0; index < recording.actions.length; index += 1) {
      const delayMs = getDelayMs(recording.actions, index);
      if (delayMs > 0) {
        await page.waitForTimeout(delayMs);
      }

      await runAction(page, recording.actions[index]);
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`;
}

function buildPuppeteerScript(recording: SessionRecordingJsonExport): string {
  const serializedRecording = JSON.stringify(recording, null, 2);
  const wildcardSpecialCharacters = JSON.stringify('\\^$+?.()|{}[]');
  const backslashLiteral = JSON.stringify('\\');

  return `const puppeteer = require('puppeteer');

const recording = ${serializedRecording};

function wildcardToRegExp(pattern) {
  let escaped = '';
  const specialCharacters = ${wildcardSpecialCharacters};
  for (const character of pattern) {
    if (character === '*') {
      escaped += '.*';
      continue;
    }

    if (specialCharacters.includes(character)) {
      escaped += ${backslashLiteral} + character;
      continue;
    }

    escaped += character;
  }

  return new RegExp('^' + escaped + '$', 'i');
}

function getScopeCandidates(page, selector) {
  if (!selector.frame || selector.frame.mode === 'main') {
    return [page.mainFrame()];
  }

  const childFrames = page.frames().filter((frame) => frame !== page.mainFrame());
  if (childFrames.length === 0) {
    return [page.mainFrame()];
  }

  if (selector.frame.mode === 'url' && selector.frame.urlPattern) {
    const pattern = wildcardToRegExp(selector.frame.urlPattern);
    const matchedFrames = childFrames.filter((frame) => pattern.test(frame.url()));
    if (matchedFrames.length > 0) {
      return matchedFrames;
    }
  }

  if (selector.frame.mode === 'auto' && childFrames.length === 1) {
    return childFrames;
  }

  return childFrames;
}

function describeSelector(selector) {
  const parts = [];
  if (selector.testId) parts.push('testId=' + selector.testId);
  if (selector.ariaLabel) parts.push('ariaLabel=' + selector.ariaLabel);
  if (selector.placeholder) parts.push('placeholder=' + selector.placeholder);
  if (selector.role) parts.push('role=' + selector.role);
  if (selector.textExact) parts.push('textExact=' + selector.textExact);
  if (selector.text) parts.push('text=' + selector.text);
  if (selector.css) parts.push('css=' + selector.css);
  if (selector.xpath) parts.push('xpath=' + selector.xpath);
  if (typeof selector.nth === 'number') parts.push('nth=' + selector.nth);
  if (selector.frame?.mode) parts.push('frame=' + selector.frame.mode);
  return parts.join(', ') || 'unknown selector';
}

async function locateElementHandle(frame, selector) {
  const handle = await frame.evaluateHandle((selectorConfig) => {
    const WS_PATTERN = new RegExp('\\s+', 'g');
    const collectByText = (elements, expectedText, exact) => {
      const normalized = expectedText.trim();
      return elements.filter((element) => {
        const text = (element.textContent || '').replace(WS_PATTERN, ' ').trim();
        return exact ? text === normalized : text.includes(normalized);
      });
    };

    const withNth = (elements) => {
      if (typeof selectorConfig.nth === 'number') {
        return elements[selectorConfig.nth] || null;
      }
      return elements[0] || null;
    };

    const candidates = [];
    const pushMatches = (elements) => {
      const picked = withNth(elements);
      if (picked) {
        candidates.push(picked);
      }
    };

    if (selectorConfig.testId) {
      pushMatches(
        Array.from(document.querySelectorAll('[data-testid]')).filter(
          (element) => element.getAttribute('data-testid') === selectorConfig.testId,
        ),
      );
    }

    if (selectorConfig.ariaLabel) {
      pushMatches(
        Array.from(document.querySelectorAll('[aria-label]')).filter(
          (element) => element.getAttribute('aria-label') === selectorConfig.ariaLabel,
        ),
      );
    }

    if (selectorConfig.placeholder) {
      pushMatches(
        Array.from(document.querySelectorAll('[placeholder]')).filter(
          (element) => element.getAttribute('placeholder') === selectorConfig.placeholder,
        ),
      );
    }

    if (selectorConfig.role && selectorConfig.textExact) {
      pushMatches(
        collectByText(
          Array.from(document.querySelectorAll('[role="' + CSS.escape(selectorConfig.role) + '"]')),
          selectorConfig.textExact,
          true,
        ),
      );
    }

    if (selectorConfig.role && selectorConfig.text) {
      pushMatches(
        collectByText(
          Array.from(document.querySelectorAll('[role="' + CSS.escape(selectorConfig.role) + '"]')),
          selectorConfig.text,
          false,
        ),
      );
    }

    if (selectorConfig.textExact) {
      pushMatches(collectByText(Array.from(document.querySelectorAll('*')), selectorConfig.textExact, true));
    }

    if (selectorConfig.text) {
      pushMatches(collectByText(Array.from(document.querySelectorAll('*')), selectorConfig.text, false));
    }

    for (const candidate of candidates) {
      if (candidate instanceof Element) {
        return candidate;
      }
    }

    if (selectorConfig.css) {
      const cssMatches = Array.from(document.querySelectorAll(selectorConfig.css));
      return withNth(cssMatches);
    }

    if (selectorConfig.xpath) {
      const snapshot = document.evaluate(
        selectorConfig.xpath,
        document,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null,
      );
      const xpathMatches = [];
      for (let index = 0; index < snapshot.snapshotLength; index += 1) {
        const item = snapshot.snapshotItem(index);
        if (item instanceof Element) {
          xpathMatches.push(item);
        }
      }
      return withNth(xpathMatches);
    }

    return withNth(candidates);
  }, selector);

  const element = handle.asElement();
  if (!element) {
    await handle.dispose();
    return null;
  }

  return element;
}

async function resolveElement(page, selector) {
  const scopes = getScopeCandidates(page, selector);
  for (const frame of scopes) {
    const element = await locateElementHandle(frame, selector);
    if (element) {
      return { frame, element };
    }
  }

  throw new Error('Unable to resolve selector: ' + describeSelector(selector));
}

function getDelayMs(actions, index) {
  if (index === 0) {
    return 0;
  }

  return Math.max(0, actions[index].timestamp - actions[index - 1].timestamp);
}

async function runAction(page, recordedAction) {
  const action = recordedAction.action;

  switch (action.type) {
    case 'navigate':
      await page.goto(action.url, {
        waitUntil: action.waitUntil === 'domContentLoaded' ? 'domcontentloaded' : action.waitUntil === 'networkIdle' ? 'networkidle0' : 'load',
      });
      return;
    case 'click': {
      const resolved = await resolveElement(page, action.selector);
      await resolved.element.click();
      await resolved.element.dispose();
      return;
    }
    case 'fill': {
      const resolved = await resolveElement(page, action.selector);
      await resolved.element.click({ clickCount: 3 });
      await resolved.element.press('Backspace');
      await resolved.element.type(action.value);
      await resolved.element.dispose();
      return;
    }
    case 'type': {
      const resolved = await resolveElement(page, action.selector);
      await resolved.element.type(action.text, typeof action.delay === 'number' ? { delay: action.delay } : undefined);
      await resolved.element.dispose();
      return;
    }
    case 'evaluate':
      console.warn('High-risk evaluate action in recording export', recordedAction.riskReason || 'Runs arbitrary page script during replay/export.');
      await page.evaluate(
        ({ script, args }) => {
          const run = new Function('args', script);
          return run(args);
        },
        { script: action.script, args: action.args || [] },
      );
      return;
    default:
      throw new Error('Unsupported recorded action type for Puppeteer export: ' + action.type);
  }
}

(async () => {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  try {
    for (let index = 0; index < recording.actions.length; index += 1) {
      const delayMs = getDelayMs(recording.actions, index);
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      await runAction(page, recording.actions[index]);
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`;
}
