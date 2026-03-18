export type OpenAIAuthChoiceId = 'api-key' | 'browser-account';

export interface OpenAIModelCatalogEntry {
  id: string;
  label: string;
  description: string;
}

export interface OpenAIRuntimeRouteResolution {
  lane: OpenAIAuthChoiceId;
  runtimeProvider: 'openai' | 'codex';
  model: string;
  mismatch:
    | {
        expectedLane: OpenAIAuthChoiceId;
        actualLane: OpenAIAuthChoiceId;
        model: string;
      }
    | null;
}

const OPENAI_MODEL_CATALOG: Record<OpenAIAuthChoiceId, {
  defaultModel: string;
  runtimeProvider: 'openai' | 'codex';
  suggestedModels: readonly OpenAIModelCatalogEntry[];
}> = {
  'api-key': {
    defaultModel: 'gpt-4o-mini',
    runtimeProvider: 'openai',
    suggestedModels: [
      {
        id: 'gpt-4o-mini',
        label: 'gpt-4o-mini',
        description: 'Fast, low-cost default for the OpenAI API lane.',
      },
      {
        id: 'gpt-4.1-mini',
        label: 'gpt-4.1-mini',
        description: 'Balanced API model for general chat and tool use.',
      },
      {
        id: 'gpt-4.1',
        label: 'gpt-4.1',
        description: 'Higher-capability API model for tougher tasks.',
      },
      {
        id: 'gpt-5',
        label: 'gpt-5',
        description: 'Latest OpenAI platform suggestion for API-key users.',
      },
    ],
  },
  'browser-account': {
    defaultModel: 'codex-mini-latest',
    runtimeProvider: 'codex',
    suggestedModels: [
      {
        id: 'codex-mini-latest',
        label: 'codex-mini-latest',
        description: 'Stable default for the account-backed Codex runtime lane.',
      },
      {
        id: 'codex-latest',
        label: 'codex-latest',
        description: 'Higher-capability account-backed model routed through Codex.',
      },
    ],
  },
};

const OPENAI_SHIPPED_MODEL_TO_LANE = Object.fromEntries(
  Object.entries(OPENAI_MODEL_CATALOG).flatMap(([lane, definition]) =>
    definition.suggestedModels.map((model) => [model.id, lane]),
  ),
) as Record<string, OpenAIAuthChoiceId>;

export function normalizeOpenAIAuthChoiceId(value: unknown): OpenAIAuthChoiceId {
  return value === 'browser-account' ? 'browser-account' : 'api-key';
}

export function getOpenAIDefaultModel(authChoiceId: OpenAIAuthChoiceId): string {
  return OPENAI_MODEL_CATALOG[authChoiceId].defaultModel;
}

export function getOpenAISuggestedModels(
  authChoiceId: OpenAIAuthChoiceId,
): readonly OpenAIModelCatalogEntry[] {
  return OPENAI_MODEL_CATALOG[authChoiceId].suggestedModels;
}

export function getOpenAIShippedModelLane(model: string | undefined): OpenAIAuthChoiceId | null {
  const normalizedModel = model?.trim();
  if (!normalizedModel) {
    return null;
  }

  return OPENAI_SHIPPED_MODEL_TO_LANE[normalizedModel] ?? null;
}

export function detectOpenAICrossLaneMismatch(
  authChoiceId: OpenAIAuthChoiceId,
  model: string | undefined,
): OpenAIRuntimeRouteResolution['mismatch'] {
  const normalizedModel = model?.trim();
  if (!normalizedModel) {
    return null;
  }

  const modelLane = getOpenAIShippedModelLane(normalizedModel);
  if (!modelLane || modelLane === authChoiceId) {
    return null;
  }

  return {
    expectedLane: authChoiceId,
    actualLane: modelLane,
    model: normalizedModel,
  };
}

export function resolveOpenAIRuntimeRoute(
  authChoiceId: OpenAIAuthChoiceId,
  model: string | undefined,
): OpenAIRuntimeRouteResolution {
  const normalizedModel = model?.trim();
  const mismatch = detectOpenAICrossLaneMismatch(authChoiceId, normalizedModel);

  return {
    lane: authChoiceId,
    runtimeProvider: OPENAI_MODEL_CATALOG[authChoiceId].runtimeProvider,
    model: normalizedModel && normalizedModel.length > 0 ? normalizedModel : getOpenAIDefaultModel(authChoiceId),
    mismatch,
  };
}
