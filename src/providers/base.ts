/**
 * Base AI Provider
 * Abstract class cho tất cả AI providers
 */

import type {
  ProviderType,
  ProviderStatus,
  ProviderConfig,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  StreamChunk,
  ProviderInfo,
} from './types';

/**
 * Abstract base class cho AI providers
 */
export abstract class BaseProvider {
  protected config: ProviderConfig;
  protected status: ProviderStatus = 'not_configured';

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  /**
   * Lấy thông tin về provider
   */
  abstract getInfo(): ProviderInfo;

  /**
   * Validate config và kết nối
   */
  abstract initialize(): Promise<void>;

  /**
   * Gửi message và nhận response
   */
  abstract chat(
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<ChatResponse>;

  /**
   * Stream response
   */
  abstract streamChat(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncIterable<StreamChunk>;

  /**
   * Lấy status hiện tại
   */
  getStatus(): ProviderStatus {
    return this.status;
  }

  /**
   * Lấy config hiện tại
   */
  getConfig(): ProviderConfig {
    return { ...this.config };
  }

  /**
   * Update config
   */
  updateConfig(config: Partial<ProviderConfig>): void {
    this.config = { ...this.config, ...config };
    this.status = 'not_configured';
  }

  /**
   * Lấy type của provider
   */
  getType(): ProviderType {
    return this.config.type;
  }

  /**
   * Kiểm tra provider đã ready chưa
   */
  isReady(): boolean {
    return this.status === 'ready';
  }

  /**
   * Format messages cho provider cụ thể (override nếu cần)
   */
  protected formatMessages(messages: ChatMessage[]): unknown {
    return messages;
  }

  /**
   * Build system prompt với context
   */
  protected buildSystemPrompt(basePrompt?: string): string {
    const defaultPrompt = `You are an AI assistant integrated into a Chrome browser extension. 
You can see and interact with web pages through special tools.
When the user asks you to do something on a webpage, use the available tools to accomplish the task.
Always explain what you're doing and confirm actions before executing them.`;

    return basePrompt || defaultPrompt;
  }
}

export default BaseProvider;
