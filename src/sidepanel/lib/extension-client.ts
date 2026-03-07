import type {
  ExtensionMessage,
  ExtensionResponse,
  ExtensionMessageType,
  RequestPayloadMap,
  ResponsePayloadMap,
} from '@shared/types';
import { generateId } from '@shared/utils';

type ExtensionEventHandler = (message: ExtensionMessage) => void;

function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<ExtensionMessage>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.channel === 'string' &&
    typeof candidate.type === 'string' &&
    typeof candidate.timestamp === 'number' &&
    'payload' in candidate
  );
}

export async function sendExtensionRequest<T extends ExtensionMessageType>(
  type: T,
  payload: RequestPayloadMap[T],
): Promise<ResponsePayloadMap[T]> {
  const message: ExtensionMessage<RequestPayloadMap[T]> = {
    id: generateId(),
    channel: 'sidePanel',
    type,
    payload,
    timestamp: Date.now(),
  };

  const response = (await chrome.runtime.sendMessage(
    message,
  )) as ExtensionResponse<ResponsePayloadMap[T]> | undefined;

  if (!response?.success) {
    throw new Error(response?.error?.message ?? `Extension request ${type} failed`);
  }

  return response.data as ResponsePayloadMap[T];
}

export function subscribeToExtensionEvents(handler: ExtensionEventHandler): () => void {
  const listener = (message: unknown): undefined => {
    if (!isExtensionMessage(message)) {
      return undefined;
    }

    handler(message);
    return undefined;
  };

  chrome.runtime.onMessage.addListener(listener);
  return () => {
    chrome.runtime.onMessage.removeListener(listener);
  };
}
