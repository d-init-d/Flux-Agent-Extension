/**
 * Agent Tool Definitions
 * Định nghĩa các tools mà AI có thể sử dụng để tương tác với trang web
 */

import type { ToolDefinition } from '../providers/types';

/**
 * Tool: Click vào element
 */
export const clickTool: ToolDefinition = {
  name: 'click',
  description: 'Click on an element on the webpage. Use CSS selector, text content, or element description to identify the target.',
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector to find the element (e.g., "#submit-btn", ".nav-link", "button[type=submit]")',
      },
      text: {
        type: 'string',
        description: 'Text content of the element to click (e.g., "Submit", "Login", "Next")',
      },
      description: {
        type: 'string',
        description: 'Human-readable description of what element to click (e.g., "the blue submit button", "login link in the header")',
      },
      doubleClick: {
        type: 'boolean',
        description: 'Whether to double-click instead of single click',
      },
      rightClick: {
        type: 'boolean',
        description: 'Whether to right-click instead of left click',
      },
    },
    required: [],
  },
};

/**
 * Tool: Type text vào input
 */
export const typeTool: ToolDefinition = {
  name: 'type',
  description: 'Type text into an input field, textarea, or contenteditable element.',
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector for the input field',
      },
      text: {
        type: 'string',
        description: 'Text to type into the field',
      },
      fieldName: {
        type: 'string',
        description: 'Name or label of the field (e.g., "email", "password", "search")',
      },
      clearFirst: {
        type: 'boolean',
        description: 'Whether to clear existing text before typing (default: true)',
      },
      pressEnter: {
        type: 'boolean',
        description: 'Whether to press Enter after typing',
      },
    },
    required: ['text'],
  },
};

/**
 * Tool: Scroll trang
 */
export const scrollTool: ToolDefinition = {
  name: 'scroll',
  description: 'Scroll the page in a direction or to a specific element.',
  parameters: {
    type: 'object',
    properties: {
      direction: {
        type: 'string',
        description: 'Direction to scroll: "up", "down", "left", "right", "top", "bottom"',
        enum: ['up', 'down', 'left', 'right', 'top', 'bottom'],
      },
      selector: {
        type: 'string',
        description: 'CSS selector of element to scroll into view',
      },
      amount: {
        type: 'number',
        description: 'Amount to scroll in pixels (default: 500)',
      },
    },
    required: [],
  },
};

/**
 * Tool: Hover over element
 */
export const hoverTool: ToolDefinition = {
  name: 'hover',
  description: 'Hover over an element to trigger hover effects, tooltips, or dropdown menus.',
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector for the element to hover over',
      },
      text: {
        type: 'string',
        description: 'Text content of the element to hover',
      },
      duration: {
        type: 'number',
        description: 'How long to hover in milliseconds (default: 1000)',
      },
    },
    required: [],
  },
};

/**
 * Tool: Extract text từ element
 */
export const extractTextTool: ToolDefinition = {
  name: 'extract_text',
  description: 'Extract text content from one or more elements on the page.',
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector for elements to extract text from',
      },
      multiple: {
        type: 'boolean',
        description: 'Whether to extract from all matching elements (default: false)',
      },
      includeHidden: {
        type: 'boolean',
        description: 'Whether to include hidden elements (default: false)',
      },
    },
    required: ['selector'],
  },
};

/**
 * Tool: Extract table data
 */
export const extractTableTool: ToolDefinition = {
  name: 'extract_table',
  description: 'Extract data from an HTML table as structured JSON.',
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector for the table element',
      },
      includeHeaders: {
        type: 'boolean',
        description: 'Whether to include table headers (default: true)',
      },
      maxRows: {
        type: 'number',
        description: 'Maximum number of rows to extract',
      },
    },
    required: [],
  },
};

/**
 * Tool: Extract links
 */
export const extractLinksTool: ToolDefinition = {
  name: 'extract_links',
  description: 'Extract all links from the page or a specific section.',
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector to limit link extraction to a specific area',
      },
      filterExternal: {
        type: 'boolean',
        description: 'Only return external links',
      },
      filterInternal: {
        type: 'boolean',
        description: 'Only return internal links',
      },
    },
    required: [],
  },
};

/**
 * Tool: Take screenshot
 */
export const screenshotTool: ToolDefinition = {
  name: 'screenshot',
  description: 'Take a screenshot of the current page or a specific element.',
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector of element to screenshot (if not provided, captures viewport)',
      },
      fullPage: {
        type: 'boolean',
        description: 'Whether to capture the full scrollable page',
      },
    },
    required: [],
  },
};

/**
 * Tool: Get page info
 */
export const getPageInfoTool: ToolDefinition = {
  name: 'get_page_info',
  description: 'Get information about the current page including URL, title, headings, forms, and interactive elements.',
  parameters: {
    type: 'object',
    properties: {
      includeContent: {
        type: 'boolean',
        description: 'Whether to include main content text',
      },
      includeForms: {
        type: 'boolean',
        description: 'Whether to include form details',
      },
      includeLinks: {
        type: 'boolean',
        description: 'Whether to include links',
      },
    },
    required: [],
  },
};

/**
 * Tool: Navigate
 */
export const navigateTool: ToolDefinition = {
  name: 'navigate',
  description: 'Navigate to a URL or use browser navigation (back, forward, refresh).',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'URL to navigate to',
      },
      action: {
        type: 'string',
        description: 'Navigation action: "back", "forward", "refresh"',
        enum: ['back', 'forward', 'refresh'],
      },
    },
    required: [],
  },
};

/**
 * Tool: Wait
 */
export const waitTool: ToolDefinition = {
  name: 'wait',
  description: 'Wait for a condition or a specified time before continuing.',
  parameters: {
    type: 'object',
    properties: {
      milliseconds: {
        type: 'number',
        description: 'Time to wait in milliseconds',
      },
      selector: {
        type: 'string',
        description: 'CSS selector to wait for element to appear',
      },
      text: {
        type: 'string',
        description: 'Text to wait for on the page',
      },
    },
    required: [],
  },
};

/**
 * Tool: Fill form
 */
export const fillFormTool: ToolDefinition = {
  name: 'fill_form',
  description: 'Fill multiple form fields at once.',
  parameters: {
    type: 'object',
    properties: {
      formSelector: {
        type: 'string',
        description: 'CSS selector for the form',
      },
      fields: {
        type: 'array',
        description: 'Array of field objects with name/selector and value',
        items: {
          type: 'object',
        },
      },
      submit: {
        type: 'boolean',
        description: 'Whether to submit the form after filling',
      },
    },
    required: ['fields'],
  },
};

/**
 * All available tools
 */
export const allTools: ToolDefinition[] = [
  clickTool,
  typeTool,
  scrollTool,
  hoverTool,
  extractTextTool,
  extractTableTool,
  extractLinksTool,
  screenshotTool,
  getPageInfoTool,
  navigateTool,
  waitTool,
  fillFormTool,
];

/**
 * Get tools by category
 */
export const toolCategories = {
  interaction: [clickTool, typeTool, scrollTool, hoverTool],
  extraction: [extractTextTool, extractTableTool, extractLinksTool, getPageInfoTool],
  navigation: [navigateTool, screenshotTool],
  utility: [waitTool, fillFormTool],
};

/**
 * Get tool by name
 */
export function getToolByName(name: string): ToolDefinition | undefined {
  return allTools.find(t => t.name === name);
}

export default allTools;
