import {
  PROVIDER_LOOKUP,
  getOpenAIDefaultModel,
  normalizeOpenAIAuthChoiceId,
} from '@shared/config';
import type { AIProviderType, ProviderConfig, SettingsGetResponse } from '@shared/types';

export type ProviderSurfaceUxKind = 'none' | 'key-based' | 'account-backed';

export interface ProviderSurfaceState {
  runtimeProvider: AIProviderType;
  surfacedProvider: AIProviderType;
  surfacedProviderLabel: string;
  uxKind: ProviderSurfaceUxKind;
  accountStatusProvider?: AIProviderType;
  openAIAuthChoiceId?: 'api-key' | 'browser-account';
  defaultModel: string;
}

function getConfiguredModel(provider: AIProviderType, config?: Partial<ProviderConfig>): string | undefined {
  const configuredModel = config?.model?.trim();
  return configuredModel && configuredModel.length > 0 ? configuredModel : undefined;
}

function resolveOpenAIDefaultModel(config?: Partial<ProviderConfig>): string {
  return getConfiguredModel('openai', config) ?? getOpenAIDefaultModel(normalizeOpenAIAuthChoiceId(config?.authChoiceId));
}

export function isOpenAIBrowserAccountSurface(config?: Partial<ProviderConfig>): boolean {
  return normalizeOpenAIAuthChoiceId(config?.authChoiceId) === 'browser-account';
}

export function resolveProviderSurfaceState(
  runtimeProvider: AIProviderType,
  settingsSnapshot: Pick<SettingsGetResponse, 'activeProvider' | 'providers'>,
): ProviderSurfaceState {
  const openAIConfig = settingsSnapshot.providers.openai;
  const hasOpenAIBrowserSurface = isOpenAIBrowserAccountSurface(openAIConfig);

  if (runtimeProvider === 'openai') {
    return hasOpenAIBrowserSurface
      ? {
          runtimeProvider,
          surfacedProvider: 'openai',
          surfacedProviderLabel: PROVIDER_LOOKUP.openai.label,
          uxKind: 'account-backed',
          accountStatusProvider: 'openai',
          openAIAuthChoiceId: 'browser-account',
          defaultModel: resolveOpenAIDefaultModel(openAIConfig),
        }
      : {
          runtimeProvider,
          surfacedProvider: 'openai',
          surfacedProviderLabel: PROVIDER_LOOKUP.openai.label,
          uxKind: 'key-based',
          openAIAuthChoiceId: 'api-key',
          defaultModel: resolveOpenAIDefaultModel(openAIConfig),
        };
  }

  if (
    runtimeProvider === 'codex' &&
    settingsSnapshot.activeProvider === 'openai' &&
    hasOpenAIBrowserSurface
  ) {
    return {
      runtimeProvider,
      surfacedProvider: 'openai',
      surfacedProviderLabel: PROVIDER_LOOKUP.openai.label,
      uxKind: 'account-backed',
      accountStatusProvider: 'openai',
      openAIAuthChoiceId: 'browser-account',
      defaultModel: resolveOpenAIDefaultModel(openAIConfig),
    };
  }

  if (runtimeProvider === 'cliproxyapi') {
    return {
      runtimeProvider,
      surfacedProvider: runtimeProvider,
      surfacedProviderLabel: PROVIDER_LOOKUP[runtimeProvider].label,
      uxKind: 'key-based',
      defaultModel:
        getConfiguredModel(runtimeProvider, settingsSnapshot.providers[runtimeProvider]) ??
        PROVIDER_LOOKUP[runtimeProvider].defaultModel,
    };
  }

  if (runtimeProvider === 'codex') {
    return {
      runtimeProvider,
      surfacedProvider: runtimeProvider,
      surfacedProviderLabel: PROVIDER_LOOKUP[runtimeProvider].label,
      uxKind: 'account-backed',
      accountStatusProvider: runtimeProvider,
      defaultModel:
        getConfiguredModel(runtimeProvider, settingsSnapshot.providers[runtimeProvider]) ??
        PROVIDER_LOOKUP[runtimeProvider].defaultModel,
    };
  }

  return {
    runtimeProvider,
    surfacedProvider: runtimeProvider,
    surfacedProviderLabel: PROVIDER_LOOKUP[runtimeProvider].label,
    uxKind: 'none',
    defaultModel:
      getConfiguredModel(runtimeProvider, settingsSnapshot.providers[runtimeProvider]) ??
      PROVIDER_LOOKUP[runtimeProvider].defaultModel,
  };
}

export function resolveActiveProviderSurfaceState(
  settingsSnapshot: Pick<SettingsGetResponse, 'activeProvider' | 'providers'>,
): ProviderSurfaceState {
  return resolveProviderSurfaceState(settingsSnapshot.activeProvider, settingsSnapshot);
}

export function resolveProviderModelForSession(
  provider: AIProviderType,
  settingsSnapshot: Pick<SettingsGetResponse, 'activeProvider' | 'providers'>,
): string {
  return resolveProviderSurfaceState(provider, settingsSnapshot).defaultModel;
}
