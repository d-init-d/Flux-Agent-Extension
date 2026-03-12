import { ErrorCode, ExtensionError } from '@shared/errors';
import type {
  ActionResultPayload,
  ExtractAction,
  ExtractAllAction,
  ScreenshotAction,
} from '@shared/types';
import { SelectorEngine } from '../dom/selector-engine';

export type ExtractExecutionAction = ExtractAction | ExtractAllAction | ScreenshotAction;

export async function executeExtractAction(
  action: ExtractExecutionAction,
  selectorEngine: SelectorEngine,
): Promise<ActionResultPayload> {
  const startedAt = performance.now();

  try {
    const data = await performExtractAction(action, selectorEngine);
    return {
      actionId: action.id,
      success: true,
      data,
      duration: getDurationMs(startedAt),
    };
  } catch (error: unknown) {
    const extensionError = ExtensionError.isExtensionError(error)
      ? error
      : new ExtensionError(
          ErrorCode.ACTION_FAILED,
          `Failed to execute action "${action.type}"`,
          true,
          error,
        );

    return {
      actionId: action.id,
      success: false,
      data: null,
      error: {
        code: extensionError.code,
        message: extensionError.message,
        stack: error instanceof Error ? error.stack : undefined,
      },
      duration: getDurationMs(startedAt),
    };
  }
}

async function performExtractAction(
  action: ExtractExecutionAction,
  selectorEngine: SelectorEngine,
): Promise<unknown> {
  switch (action.type) {
    case 'extract':
      return extractSingleValue(action, selectorEngine);
    case 'extractAll':
      return extractMultipleValues(action, selectorEngine);
    case 'screenshot':
      return captureElementSnapshot(action, selectorEngine);
    case 'fullPageScreenshot':
      return captureDocumentSnapshot();
    default:
      return assertNever(action);
  }
}

function extractSingleValue(
  action: ExtractAction,
  selectorEngine: SelectorEngine,
): { value: unknown } {
  const element = selectorEngine.findElement(action.selector);
  if (!element) {
    throw new ExtensionError(
      ErrorCode.ELEMENT_NOT_FOUND,
      'Element not found for extract action',
      true,
      { selector: action.selector },
    );
  }

  const attribute = action.attribute ?? 'textContent';
  return { value: readElementAttribute(element, attribute) };
}

function extractMultipleValues(
  action: ExtractAllAction,
  selectorEngine: SelectorEngine,
): { items: Array<Record<string, unknown>> } {
  const elements = selectorEngine.findElements(action.selector);
  if (elements.length === 0) {
    throw new ExtensionError(
      ErrorCode.ELEMENT_NOT_FOUND,
      'No elements found for extractAll action',
      true,
      { selector: action.selector },
    );
  }

  const attributes =
    action.attributes && action.attributes.length > 0 ? action.attributes : ['textContent'];
  const capped =
    typeof action.limit === 'number' && action.limit > 0
      ? elements.slice(0, action.limit)
      : elements;

  const items = capped.map((element) => {
    const entry: Record<string, unknown> = {};
    for (const attribute of attributes) {
      entry[attribute] = readElementAttribute(element, attribute);
    }
    return entry;
  });

  return { items };
}

function captureElementSnapshot(
  action: ScreenshotAction,
  selectorEngine: SelectorEngine,
): { image: string; mimeType: string } {
  if (action.selector) {
    const element = selectorEngine.findElement(action.selector);
    if (!element) {
      throw new ExtensionError(
        ErrorCode.ELEMENT_NOT_FOUND,
        'Element not found for screenshot action',
        true,
        { selector: action.selector },
      );
    }
    return encodeElementToSvgDataUrl(element);
  }

  return encodeElementToSvgDataUrl(document.body);
}

function captureDocumentSnapshot(): { image: string; mimeType: string } {
  return encodeElementToSvgDataUrl(document.documentElement);
}

function encodeElementToSvgDataUrl(element: Element): { image: string; mimeType: string } {
  const serialized = serializeElement(element);
  const escaped = escapeXml(serialized);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600"><foreignObject width="100%" height="100%">${escaped}</foreignObject></svg>`;
  const image = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  return { image, mimeType: 'image/svg+xml' };
}

function serializeElement(element: Element): string {
  try {
    return new XMLSerializer().serializeToString(element);
  } catch {
    throw new ExtensionError(ErrorCode.ACTION_FAILED, 'Failed to serialize element snapshot', true);
  }
}

function readElementAttribute(element: Element, attribute: string): unknown {
  if (attribute === 'textContent') {
    return (element.textContent ?? '').trim();
  }

  if (attribute === 'innerHTML' && element instanceof HTMLElement) {
    return element.innerHTML;
  }

  if (attribute === 'outerHTML' && element instanceof HTMLElement) {
    return element.outerHTML;
  }

  if (attribute in element) {
    return (element as unknown as Record<string, unknown>)[attribute];
  }

  return element.getAttribute(attribute);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getDurationMs(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function assertNever(value: never): never {
  throw new ExtensionError(
    ErrorCode.ACTION_INVALID,
    `Unsupported extract action: ${String(value)}`,
    false,
  );
}
