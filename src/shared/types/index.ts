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
  FrameTarget,
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
  UploadFileAction,
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
  MockGeolocationAction,
  Action,
  ParsedResponse,
} from './actions';

export { FILE_UPLOAD_LIMITS } from './uploads';
export type { FileUploadMetadata, SerializedFileUpload } from './uploads';

// Browser types
export type {
  TabState,
  SessionTabSummary,
  ActionResult,
  BrowserControllerOptions,
  FrameDescriptor,
  FrameContextSummary,
  PageContext,
  InteractiveElement,
  FormInfo,
  ScreenshotOptions,
} from './browser';

// Bridge types
export type {
  MessageType,
  BridgeMessage,
  BridgeSendTarget,
  BridgeFrameContext,
  ExecuteActionPayload,
  ActionResultPayload,
  GetPageContextPayload,
  PageContextPayload,
  HighlightPayload,
  SetRecordingStatePayload,
  RecordedClickPayload,
  RecordedInputPayload,
  RecordedNavigationPayload,
} from './bridge';

// Session types
export type {
  SessionStatus,
  SessionConfig,
  Session,
  ActionRecord,
  RecordedSessionAction,
  SessionRecordingStatus,
  SessionRecordingState,
  SessionPlaybackStatus,
  SessionPlaybackSpeed,
  SessionPlaybackError,
  SessionPlaybackState,
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
  SessionPlaybackControlRequest,
  SessionPlaybackStartRequest,
  SessionPlaybackResumeRequest,
  SessionPlaybackSetSpeedRequest,
  SessionSendMessageRequest,
  ActionExecuteRequest,
  ActionExecuteResponse,
  ContextGetRequest,
  ContextGetResponse,
  MessageSender,
  RequestPayloadMap,
  ResponsePayloadMap,
} from './messages';
