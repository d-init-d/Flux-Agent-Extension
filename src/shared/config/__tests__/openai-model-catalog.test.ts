import {
  detectOpenAICrossLaneMismatch,
  getOpenAIDefaultModel,
  getOpenAIShippedModelLane,
  getOpenAISuggestedModels,
  normalizeOpenAIAuthChoiceId,
  resolveOpenAIRuntimeRoute,
} from '@shared/config';
import { describe, expect, it } from 'vitest';

describe('openai model catalog', () => {
  it('returns lane-specific defaults and suggestions', () => {
    expect(getOpenAIDefaultModel('api-key')).toBe('gpt-4o-mini');
    expect(getOpenAIDefaultModel('browser-account')).toBe('codex-mini-latest');
    expect(getOpenAISuggestedModels('api-key').map((model) => model.id)).toEqual([
      'gpt-4o-mini',
      'gpt-4.1-mini',
      'gpt-4.1',
      'gpt-5',
    ]);
    expect(getOpenAISuggestedModels('browser-account').map((model) => model.id)).toEqual([
      'codex-mini-latest',
      'codex-latest',
    ]);
  });

  it('normalizes auth choice ids conservatively', () => {
    expect(normalizeOpenAIAuthChoiceId('browser-account')).toBe('browser-account');
    expect(normalizeOpenAIAuthChoiceId('api-key')).toBe('api-key');
    expect(normalizeOpenAIAuthChoiceId('anything-else')).toBe('api-key');
  });

  it('detects shipped model lanes and obvious cross-lane mismatches', () => {
    expect(getOpenAIShippedModelLane('gpt-4.1-mini')).toBe('api-key');
    expect(getOpenAIShippedModelLane('codex-latest')).toBe('browser-account');
    expect(getOpenAIShippedModelLane('my-manual-model')).toBeNull();
    expect(detectOpenAICrossLaneMismatch('browser-account', 'gpt-4o-mini')).toEqual({
      expectedLane: 'browser-account',
      actualLane: 'api-key',
      model: 'gpt-4o-mini',
    });
    expect(detectOpenAICrossLaneMismatch('browser-account', 'my-manual-model')).toBeNull();
  });

  it('resolves runtime routing while keeping unknown model ids as manual overrides', () => {
    expect(resolveOpenAIRuntimeRoute('api-key', '')).toEqual({
      lane: 'api-key',
      runtimeProvider: 'openai',
      model: 'gpt-4o-mini',
      mismatch: null,
    });
    expect(resolveOpenAIRuntimeRoute('browser-account', 'codex-latest')).toEqual({
      lane: 'browser-account',
      runtimeProvider: 'codex',
      model: 'codex-latest',
      mismatch: null,
    });
    expect(resolveOpenAIRuntimeRoute('browser-account', 'manual-browser-model')).toEqual({
      lane: 'browser-account',
      runtimeProvider: 'codex',
      model: 'manual-browser-model',
      mismatch: null,
    });
  });
});
