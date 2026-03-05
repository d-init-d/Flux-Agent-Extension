import type { AIMessage } from '@shared/types';
import { estimateMessageTokens, estimateTokens, getModelMaxTokens } from '../token-counter';

describe('token-counter', () => {
  describe('estimateTokens', () => {
    it('returns 0 for empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });

    it('estimates CJK text at higher density', () => {
      expect(estimateTokens('你好')).toBe(3);
      expect(estimateTokens('こんにちは')).toBe(8);
    });

    it('adds code-special-character bonus tokens', () => {
      const prose = estimateTokens('const x y z');
      const codeLike = estimateTokens('const x = y + z;');

      expect(codeLike).toBeGreaterThan(prose);
    });
  });

  describe('estimateMessageTokens', () => {
    it('returns 0 for empty message array', () => {
      expect(estimateMessageTokens([])).toBe(0);
    });

    it('includes per-message overhead and conversation overhead', () => {
      const messages: AIMessage[] = [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'world' },
      ];

      // "hello"=2 tokens, "world"=2 tokens
      // total = conversation(3) + messages(2 * 4) + content(2 + 2) = 15
      expect(estimateMessageTokens(messages)).toBe(15);
    });

    it('counts multimodal image blocks by detail level', () => {
      const lowDetail: AIMessage[] = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'ok' },
            {
              type: 'image',
              image_url: { url: 'data:image/png;base64,AAA', detail: 'low' },
            },
          ],
        },
      ];

      const highDetail: AIMessage[] = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'ok' },
            {
              type: 'image',
              image_url: { url: 'data:image/png;base64,AAA', detail: 'high' },
            },
          ],
        },
      ];

      expect(estimateMessageTokens(lowDetail)).toBe(93);
      expect(estimateMessageTokens(highDetail)).toBe(773);
    });
  });

  describe('getModelMaxTokens', () => {
    it('returns exact match limits for known models', () => {
      expect(getModelMaxTokens('openai', 'gpt-4o')).toBe(128000);
      expect(getModelMaxTokens('claude', 'claude-4-sonnet-20250514')).toBe(200000);
      expect(getModelMaxTokens('gemini', 'gemini-1.5-pro')).toBe(2000000);
    });

    it('supports partial model-name matching', () => {
      expect(getModelMaxTokens('openai', 'gpt-4o-2024-08-06')).toBe(128000);
      expect(getModelMaxTokens('openai', 'gpt-4-turbo-preview')).toBe(128000);
    });

    it('falls back to provider defaults for unknown models', () => {
      expect(getModelMaxTokens('claude', 'unknown-claude-model')).toBe(200000);
      expect(getModelMaxTokens('openai', 'unknown-openai-model')).toBe(128000);
      expect(getModelMaxTokens('gemini', 'unknown-gemini-model')).toBe(1000000);
      expect(getModelMaxTokens('ollama', 'mystery-local-model')).toBe(8192);
      expect(getModelMaxTokens('openrouter', 'mystery-openrouter-model')).toBe(128000);
      expect(getModelMaxTokens('custom', 'anything')).toBe(4096);
    });
  });
});
