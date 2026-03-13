import type { AIProviderType } from '@shared/types';
import type { IAIProvider } from './interfaces';

export type LazyLoadableProviderType = Exclude<AIProviderType, 'custom'>;

export async function createProvider(type: LazyLoadableProviderType): Promise<IAIProvider> {
  switch (type) {
    case 'claude': {
      const { ClaudeProvider } = await import('./providers/claude');
      return new ClaudeProvider();
    }
    case 'openai': {
      const { OpenAIProvider } = await import('./providers/openai');
      return new OpenAIProvider();
    }
    case 'gemini': {
      const { GeminiProvider } = await import('./providers/gemini');
      return new GeminiProvider();
    }
    case 'ollama': {
      const { OllamaProvider } = await import('./providers/ollama');
      return new OllamaProvider();
    }
    case 'openrouter': {
      const { OpenRouterProvider } = await import('./providers/openrouter');
      return new OpenRouterProvider();
    }
    case 'copilot': {
      const { CopilotProvider } = await import('./providers/copilot');
      return new CopilotProvider();
    }
    case 'groq':
    case 'deepseek':
    case 'xai':
    case 'together':
    case 'fireworks':
    case 'deepinfra':
    case 'cerebras':
    case 'mistral':
    case 'perplexity': {
      const { createOpenAICompatProvider } = await import('./providers/openai-compat');
      return createOpenAICompatProvider(type);
    }
  }

  throw new Error(`Unsupported provider: ${type}`);
}
