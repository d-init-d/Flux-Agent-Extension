import type { Action, ActionResult, TabState, PageContext, ScreenshotOptions } from '@shared/types';

/**
 * Main browser controller interface.
 * Coordinates action execution against a target browser tab.
 */
export interface IBrowserController {
  /** Initialize controller for a tab */
  attachToTab(tabId: number): Promise<void>;

  /** Detach from current tab */
  detach(): Promise<void>;

  /** Execute a single action */
  execute(action: Action): Promise<ActionResult>;

  /** Execute multiple actions in sequence */
  executeSequence(
    actions: Action[],
    options?: {
      stopOnError?: boolean;
      onProgress?: (result: ActionResult, index: number) => void;
    },
  ): Promise<ActionResult[]>;

  /** Get current tab state */
  getTabState(): TabState | null;

  /** Get page context for AI */
  getPageContext(): Promise<PageContext>;

  /** Take screenshot */
  captureScreenshot(options?: ScreenshotOptions): Promise<string>;

  /** Abort current action */
  abort(): void;
}
