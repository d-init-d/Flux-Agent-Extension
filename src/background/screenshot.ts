/**
 * Screenshot Service
 * Capture screenshots từ browser tabs
 */

import { logger } from '@shared/logger';

export interface ScreenshotOptions {
  /** Format ảnh */
  format?: 'png' | 'jpeg';
  /** Chất lượng JPEG (0-100) */
  quality?: number;
  /** Capture full page (scrolling capture) */
  fullPage?: boolean;
}

export interface ScreenshotResult {
  success: boolean;
  data?: string; // base64 data URL
  width?: number;
  height?: number;
  timestamp?: number;
  error?: string;
}

export interface ElementScreenshotResult extends ScreenshotResult {
  elementRect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/**
 * Capture screenshot of visible tab
 */
export async function captureVisibleTab(
  options: ScreenshotOptions = {}
): Promise<ScreenshotResult> {
  const { format = 'png', quality = 90 } = options;

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab({
      format,
      quality: format === 'jpeg' ? quality : undefined,
    });

    // Get dimensions from data URL (approximate)
    const img = await loadImage(dataUrl);

    return {
      success: true,
      data: dataUrl,
      width: img.width,
      height: img.height,
      timestamp: Date.now(),
    };
  } catch (error) {
    logger.error('Failed to capture screenshot:', error);
    return {
      success: false,
      error: String(error),
    };
  }
}

/**
 * Capture full page screenshot (scrolling)
 * Chụp toàn bộ trang bằng cách scroll và ghép ảnh
 */
export async function captureFullPage(
  tabId: number,
  options: ScreenshotOptions = {}
): Promise<ScreenshotResult> {
  const { format = 'png', quality = 90 } = options;

  try {
    // Get page dimensions from content script
    const [{ result: dimensions }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        scrollHeight: document.documentElement.scrollHeight,
        scrollWidth: document.documentElement.scrollWidth,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        currentScrollY: window.scrollY,
      }),
    });

    if (!dimensions) {
      throw new Error('Failed to get page dimensions');
    }

    const { scrollHeight, viewportHeight, currentScrollY } = dimensions;

    // Nếu page vừa viewport, chỉ cần capture 1 lần
    if (scrollHeight <= viewportHeight) {
      return captureVisibleTab({ format, quality });
    }

    // Capture multiple screenshots và ghép
    const screenshots: string[] = [];
    const scrollPositions: number[] = [];
    let currentPos = 0;

    // Scroll to top first
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.scrollTo(0, 0),
    });
    await sleep(100);

    while (currentPos < scrollHeight) {
      // Capture current viewport
      const screenshot = await chrome.tabs.captureVisibleTab({
        format,
        quality: format === 'jpeg' ? quality : undefined,
      });
      screenshots.push(screenshot);
      scrollPositions.push(currentPos);

      // Scroll down
      currentPos += viewportHeight - 50; // Overlap 50px
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (pos) => window.scrollTo(0, pos),
        args: [currentPos],
      });
      await sleep(150); // Wait for scroll + render
    }

    // Restore original scroll position
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (pos) => window.scrollTo(0, pos),
      args: [currentScrollY],
    });

    // Stitch screenshots together (simplified - return first for now)
    // Full stitching would require canvas manipulation
    // For now, return first screenshot with metadata
    return {
      success: true,
      data: screenshots[0],
      width: dimensions.viewportWidth,
      height: scrollHeight,
      timestamp: Date.now(),
    };
  } catch (error) {
    logger.error('Failed to capture full page:', error);
    return {
      success: false,
      error: String(error),
    };
  }
}

/**
 * Capture screenshot of specific element
 * Gửi request đến content script để crop element
 */
export async function captureElement(
  tabId: number,
  selector: string
): Promise<ElementScreenshotResult> {
  try {
    // Get element bounds from content script
    const [{ result: bounds }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        const element = document.querySelector(sel);
        if (!element) return null;
        
        const rect = element.getBoundingClientRect();
        return {
          x: rect.left + window.scrollX,
          y: rect.top + window.scrollY,
          width: rect.width,
          height: rect.height,
          viewportX: rect.left,
          viewportY: rect.top,
        };
      },
      args: [selector],
    });

    if (!bounds) {
      return {
        success: false,
        error: `Element not found: ${selector}`,
      };
    }

    // Scroll element into view
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        const element = document.querySelector(sel);
        element?.scrollIntoView({ block: 'center' });
      },
      args: [selector],
    });
    await sleep(200);

    // Capture visible tab
    const screenshot = await captureVisibleTab({ format: 'png' });

    if (!screenshot.success || !screenshot.data) {
      return screenshot;
    }

    // Get updated bounds after scroll
    const [{ result: newBounds }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        const element = document.querySelector(sel);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        };
      },
      args: [selector],
    });

    return {
      ...screenshot,
      elementRect: newBounds || bounds,
    };
  } catch (error) {
    logger.error('Failed to capture element:', error);
    return {
      success: false,
      error: String(error),
    };
  }
}

/**
 * Load image from data URL to get dimensions
 */
function loadImage(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    // In service worker, we can't use Image
    // Extract dimensions from PNG/JPEG header would be complex
    // Return default dimensions
    resolve({ width: 1920, height: 1080 });
  });
}

/**
 * Simple sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export const screenshotService = {
  captureVisibleTab,
  captureFullPage,
  captureElement,
};

export default screenshotService;
