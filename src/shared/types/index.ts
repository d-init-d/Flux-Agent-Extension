// AI types
export type {
  AIProviderType,
  AIModelConfig,
  AIMessage,
  AIMessageContent,
  AIStreamChunk,
  AIRequestOptions,
  AITool,
} from './ai';

// Action types
export type {
  ActionType,
  ElementSelector,
  BaseAction,
  NavigateAction,
  GoBackAction,
  GoForwardAction,
  ReloadAction,
  ClickAction,
  HoverAction,
  FocusAction,
  FillAction,
  TypeAction,
  ClearAction,
  SelectAction,
  CheckAction,
  PressAction,
  HotkeyAction,
  ScrollAction,
  ScrollIntoViewAction,
  WaitAction,
  WaitForElementAction,
  WaitForNavigationAction,
  WaitForNetworkAction,
  ExtractAction,
  ExtractAllAction,
  ScreenshotAction,
  NewTabAction,
  CloseTabAction,
  SwitchTabAction,
  EvaluateAction,
  DevicePreset,
  EmulateDeviceAction,
  NetworkResourceType,
  InterceptNetworkOperation,
  InterceptNetworkAction,
  MockResponseDefinition,
  MockResponseAction,
  Action,
  ParsedResponse,
} from './actions';

// Browser types
export type {
  TabState,
  ActionResult,
  BrowserControllerOptions,
  PageContext,
  InteractiveElement,
  FormInfo,
  ScreenshotOptions,
} from './browser';

// Bridge types
export type {
  MessageType,
  BridgeMessage,
  ExecuteActionPayload,
  ActionResultPayload,
  PageContextPayload,
  HighlightPayload,
} from './bridge';

// Session types
export type {
  SessionStatus,
  SessionConfig,
  Session,
  ActionRecord,
  SessionEvent,
} from './session';

// Storage types
export type {
  StorageSchema,
  ExtensionSettings,
  OnboardingState,
  ProviderConfig,
  UsageStats,
} from './storage';

// Message types
export type {
  MessageChannel,
  ExtensionMessageType,
  ExtensionMessage,
  ExtensionResponse,
  SessionCreateRequest,
  SessionCreateResponse,
  SessionUpdateReason,
  SessionUpdateEventPayload,
  ActionLogEventStatus,
  ActionLogEventEntry,
  ActionProgressEventPayload,
  AIStreamEventPayload,
  SessionStartRequest,
  ActionExecuteRequest,
  ActionExecuteResponse,
  ContextGetRequest,
  ContextGetResponse,
  MessageSender,
  RequestPayloadMap,
  ResponsePayloadMap,
} from './messages';
