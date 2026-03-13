import type { ActionType } from '@shared/types';
import { SHIPPED_ACTION_TYPES } from '@shared/config';
import { z } from 'zod';

const NETWORK_RESOURCE_TYPES = [
  'Document',
  'XHR',
  'Fetch',
  'Script',
  'Image',
  'Stylesheet',
  'Media',
  'Other',
] as const;

const ACTION_TYPES = SHIPPED_ACTION_TYPES satisfies readonly ActionType[];

const actionTypeSchema = z.enum(ACTION_TYPES);
const networkResourceTypeSchema = z.enum(NETWORK_RESOURCE_TYPES);
const devicePresetSchema = z.enum(['iphone', 'pixel', 'ipad']);

const elementSelectorSchema = z
  .object({
    css: z.string().min(1).optional(),
    xpath: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    textExact: z.string().min(1).optional(),
    ariaLabel: z.string().min(1).optional(),
    placeholder: z.string().min(1).optional(),
    testId: z.string().min(1).optional(),
    role: z.string().min(1).optional(),
    nth: z.number().int().min(0).optional(),
    nearText: z.string().min(1).optional(),
    withinSection: z.string().min(1).optional(),
    frame: z
      .object({
        mode: z.enum(['main', 'auto', 'frameId', 'documentId', 'url']).optional(),
        frameId: z.number().int().min(0).optional(),
        documentId: z.string().min(1).optional(),
        urlPattern: z.string().min(1).optional(),
      })
      .optional(),
  })
  .refine((selector) => Object.keys(selector).length > 0, {
    message: 'selector must include at least one selector strategy',
  });

const baseActionSchema = z.object({
  id: z.string().min(1, 'Action id is required'),
  type: actionTypeSchema,
  description: z.string().optional(),
  timeout: z.number().int().nonnegative().optional(),
  optional: z.boolean().optional(),
  retries: z.number().int().min(0).optional(),
});

const urlPatternsSchema = z.array(z.string().min(1)).min(1);
const responseHeadersSchema = z.record(z.string().min(1), z.string());

function createClickLikeSchema(type: 'click' | 'doubleClick' | 'rightClick') {
  return baseActionSchema.extend({
    type: z.literal(type),
    selector: elementSelectorSchema,
    position: z.object({ x: z.number(), y: z.number() }).optional(),
    modifiers: z.array(z.enum(['ctrl', 'shift', 'alt', 'meta'])).optional(),
  });
}

function createScreenshotLikeSchema(type: 'screenshot' | 'fullPageScreenshot') {
  return baseActionSchema.extend({
    type: z.literal(type),
    selector: elementSelectorSchema.optional(),
    format: z.enum(['png', 'jpeg']).optional(),
    quality: z.number().int().min(0).max(100).optional(),
    outputVariable: z.string().min(1).optional(),
  });
}

const selectorRequiredSchema = {
  hover: baseActionSchema.extend({ type: z.literal('hover'), selector: elementSelectorSchema }),
  focus: baseActionSchema.extend({ type: z.literal('focus'), selector: elementSelectorSchema }),
  fill: baseActionSchema.extend({
    type: z.literal('fill'),
    selector: elementSelectorSchema,
    value: z.string(),
    clearFirst: z.boolean().optional(),
  }),
  type: baseActionSchema.extend({
    type: z.literal('type'),
    selector: elementSelectorSchema,
    text: z.string(),
    delay: z.number().int().nonnegative().optional(),
  }),
  clear: baseActionSchema.extend({ type: z.literal('clear'), selector: elementSelectorSchema }),
  uploadFile: baseActionSchema.extend({
    type: z.literal('uploadFile'),
    selector: elementSelectorSchema,
    fileIds: z.array(z.string().min(1)).min(1),
    clearFirst: z.boolean().optional(),
  }),
  select: baseActionSchema.extend({
    type: z.literal('select'),
    selector: elementSelectorSchema,
    option: z.union([
      z.string(),
      z
        .object({
          value: z.string().optional(),
          label: z.string().optional(),
          index: z.number().int().min(0).optional(),
        })
        .refine(
          (value) =>
            value.value !== undefined || value.label !== undefined || value.index !== undefined,
          {
            message: 'option object must include value, label, or index',
          },
        ),
    ]),
  }),
  check: baseActionSchema.extend({ type: z.literal('check'), selector: elementSelectorSchema }),
  uncheck: baseActionSchema.extend({ type: z.literal('uncheck'), selector: elementSelectorSchema }),
  scrollIntoView: baseActionSchema.extend({
    type: z.literal('scrollIntoView'),
    selector: elementSelectorSchema,
    block: z.enum(['start', 'center', 'end']).optional(),
  }),
  waitForElement: baseActionSchema.extend({
    type: z.literal('waitForElement'),
    selector: elementSelectorSchema,
    state: z.enum(['visible', 'hidden', 'attached', 'detached']).optional(),
  }),
  extract: baseActionSchema.extend({
    type: z.literal('extract'),
    selector: elementSelectorSchema,
    attribute: z.string().optional(),
    outputVariable: z.string().min(1).optional(),
  }),
  extractAll: baseActionSchema.extend({
    type: z.literal('extractAll'),
    selector: elementSelectorSchema,
    attributes: z.array(z.string()).optional(),
    limit: z.number().int().min(1).optional(),
    outputVariable: z.string().min(1).optional(),
  }),
};

const actionSchemas = {
  navigate: baseActionSchema.extend({
    type: z.literal('navigate'),
    url: z.string().min(1),
    waitUntil: z.enum(['load', 'domContentLoaded', 'networkIdle']).optional(),
  }),
  goBack: baseActionSchema.extend({ type: z.literal('goBack') }),
  goForward: baseActionSchema.extend({ type: z.literal('goForward') }),
  reload: baseActionSchema.extend({
    type: z.literal('reload'),
    hardReload: z.boolean().optional(),
  }),
  click: createClickLikeSchema('click'),
  doubleClick: createClickLikeSchema('doubleClick'),
  rightClick: createClickLikeSchema('rightClick'),
  ...selectorRequiredSchema,
  press: baseActionSchema.extend({
    type: z.literal('press'),
    key: z.string().min(1),
    selector: elementSelectorSchema.optional(),
  }),
  hotkey: baseActionSchema.extend({
    type: z.literal('hotkey'),
    keys: z.array(z.string().min(1)).min(1),
  }),
  scroll: baseActionSchema.extend({
    type: z.literal('scroll'),
    direction: z.enum(['up', 'down', 'left', 'right']),
    amount: z.number().int().optional(),
    selector: elementSelectorSchema.optional(),
  }),
  wait: baseActionSchema.extend({ type: z.literal('wait'), duration: z.number().int().min(0) }),
  waitForNavigation: baseActionSchema.extend({
    type: z.literal('waitForNavigation'),
    urlPattern: z.string().optional(),
  }),
  waitForNetwork: baseActionSchema.extend({
    type: z.literal('waitForNetwork'),
    state: z.enum(['idle', 'busy']),
    timeout: z.number().int().nonnegative().optional(),
  }),
  screenshot: createScreenshotLikeSchema('screenshot'),
  fullPageScreenshot: createScreenshotLikeSchema('fullPageScreenshot'),
  newTab: baseActionSchema.extend({
    type: z.literal('newTab'),
    url: z.string().optional(),
    active: z.boolean().optional(),
  }),
  closeTab: baseActionSchema.extend({
    type: z.literal('closeTab'),
    tabIndex: z.number().int().min(0).optional(),
  }),
  switchTab: baseActionSchema.extend({
    type: z.literal('switchTab'),
    tabIndex: z.number().int().min(0),
  }),
  evaluate: baseActionSchema.extend({
    type: z.literal('evaluate'),
    script: z.string().min(1),
    args: z.array(z.unknown()).optional(),
    outputVariable: z.string().min(1).optional(),
  }),
  emulateDevice: baseActionSchema.extend({
    type: z.literal('emulateDevice'),
    preset: devicePresetSchema,
    orientation: z.enum(['portrait', 'landscape']).optional(),
  }),
  interceptNetwork: baseActionSchema.extend({
    type: z.literal('interceptNetwork'),
    urlPatterns: urlPatternsSchema,
    operation: z.enum(['continue', 'block']),
    resourceTypes: z.array(networkResourceTypeSchema).min(1).optional(),
  }),
  mockResponse: baseActionSchema.extend({
    type: z.literal('mockResponse'),
    urlPatterns: urlPatternsSchema,
    resourceTypes: z.array(networkResourceTypeSchema).min(1).optional(),
    response: z.object({
      status: z.number().int().min(100).max(599),
      headers: responseHeadersSchema.optional(),
      body: z.string(),
      bodyEncoding: z.enum(['utf8', 'base64']).optional(),
      contentType: z.string().min(1).optional(),
    }),
  }),
  mockGeolocation: baseActionSchema.extend({
    type: z.literal('mockGeolocation'),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracy: z.number().positive().optional(),
  }),
  savePdf: baseActionSchema.extend({
    type: z.literal('savePdf'),
    filename: z.string().min(1).optional(),
    landscape: z.boolean().optional(),
    printBackground: z.boolean().optional(),
    scale: z.number().min(0.1).max(2).optional(),
    paperWidth: z.number().positive().optional(),
    paperHeight: z.number().positive().optional(),
    marginTop: z.number().min(0).optional(),
    marginRight: z.number().min(0).optional(),
    marginBottom: z.number().min(0).optional(),
    marginLeft: z.number().min(0).optional(),
    pageRanges: z.string().optional(),
    headerTemplate: z.string().optional(),
    footerTemplate: z.string().optional(),
    displayHeaderFooter: z.boolean().optional(),
    preferCSSPageSize: z.boolean().optional(),
  }),
};

const orderedActionSchemas = [
  actionSchemas.navigate,
  actionSchemas.goBack,
  actionSchemas.goForward,
  actionSchemas.reload,
  actionSchemas.click,
  actionSchemas.doubleClick,
  actionSchemas.rightClick,
  actionSchemas.hover,
  actionSchemas.focus,
  actionSchemas.fill,
  actionSchemas.type,
  actionSchemas.clear,
  actionSchemas.uploadFile,
  actionSchemas.select,
  actionSchemas.check,
  actionSchemas.uncheck,
  actionSchemas.press,
  actionSchemas.hotkey,
  actionSchemas.scroll,
  actionSchemas.scrollIntoView,
  actionSchemas.wait,
  actionSchemas.waitForElement,
  actionSchemas.waitForNavigation,
  actionSchemas.waitForNetwork,
  actionSchemas.extract,
  actionSchemas.extractAll,
  actionSchemas.screenshot,
  actionSchemas.fullPageScreenshot,
  actionSchemas.newTab,
  actionSchemas.closeTab,
  actionSchemas.switchTab,
  actionSchemas.evaluate,
  actionSchemas.emulateDevice,
  actionSchemas.interceptNetwork,
  actionSchemas.mockResponse,
  actionSchemas.mockGeolocation,
  actionSchemas.savePdf,
] as const;

export const actionSchema = z.discriminatedUnion('type', orderedActionSchemas);

export function validateActionSchema(action: unknown): { valid: boolean; errors?: string[] } {
  const result = actionSchema.safeParse(action);
  if (result.success) {
    return { valid: true };
  }

  const errors = result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'action';
    return `${path}: ${issue.message}`;
  });

  return {
    valid: false,
    errors,
  };
}

export { ACTION_TYPES, actionSchemas, actionTypeSchema, baseActionSchema, elementSelectorSchema };
