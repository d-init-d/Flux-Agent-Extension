import { PROVIDER_REGISTRY } from '@shared/config';
import type { AIProviderType, OnboardingState } from '@shared/types';

export const ONBOARDING_STORAGE_KEY = 'onboarding' as const;
export const ONBOARDING_VERSION = 1;
export const ONBOARDING_STEP_COUNT = 4;

const ONBOARDING_PROVIDER_TYPES = PROVIDER_REGISTRY.map((provider) => provider.type) as readonly AIProviderType[];

function isOnboardingProviderType(
  value: unknown,
): value is AIProviderType {
  return typeof value === 'string' && ONBOARDING_PROVIDER_TYPES.includes(value as AIProviderType);
}

export function createDefaultOnboardingState(): OnboardingState {
  return {
    version: ONBOARDING_VERSION,
    completed: false,
    lastStep: 0,
    providerReady: false,
  };
}

export function normalizeOnboardingState(value: unknown): OnboardingState {
  const defaults = createDefaultOnboardingState();

  if (!value || typeof value !== 'object') {
    return defaults;
  }

  const candidate = value as Partial<OnboardingState>;
  const lastStep =
    typeof candidate.lastStep === 'number'
      ? Math.min(Math.max(Math.trunc(candidate.lastStep), 0), ONBOARDING_STEP_COUNT - 1)
      : defaults.lastStep;

  return {
    version: typeof candidate.version === 'number' ? candidate.version : defaults.version,
    completed: candidate.completed === true,
    lastStep,
    completedAt: typeof candidate.completedAt === 'number' ? candidate.completedAt : undefined,
    providerReady: candidate.providerReady === true,
    configuredProvider: isOnboardingProviderType(candidate.configuredProvider)
      ? candidate.configuredProvider
      : undefined,
    validatedProvider: isOnboardingProviderType(candidate.validatedProvider)
      ? candidate.validatedProvider
      : undefined,
    resumeRequestedAt:
      typeof candidate.resumeRequestedAt === 'number' ? candidate.resumeRequestedAt : undefined,
  };
}
