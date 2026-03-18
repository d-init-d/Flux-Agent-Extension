import type { ReactNode } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from 'lucide-react';
import { Badge, Button, Card, CardContent } from '@ui/components';
import { ONBOARDING_STEP_COUNT } from '@shared/storage/onboarding';
import type { ExtensionSettings } from '@shared/types';

interface OnboardingFlowProps {
  currentStep: number;
  selectedProviderLabel: string;
  enabledPermissionCount: number;
  theme: ExtensionSettings['theme'];
  language: ExtensionSettings['language'];
  providerRequiresApiKey: boolean;
  providerRequiresEndpoint?: boolean;
  providerUsesAccountImport?: boolean;
  providerStatusLabel?: string;
  providerSetupHint?: string;
  providerReadyHint?: string;
  providerSetupPanel: ReactNode;
  onStepChange: (step: number) => void;
  onSkip: () => void;
  onComplete: () => void;
  canComplete?: boolean;
  isBusy?: boolean;
  isCompleting?: boolean;
}

const ONBOARDING_STEPS = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'connect', label: 'Connect AI' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'ready', label: 'Ready' },
] as const;

const CAN_DO = [
  'Navigate across pages and tabs when you ask for a workflow.',
  'Click, fill, and inspect page elements with visible feedback.',
  'Capture screenshots and page context to improve AI guidance.',
  'Reuse popup quick actions for lightweight page analysis.',
];

const CANNOT_DO = [
  'Store raw provider keys in plaintext inside extension storage.',
  'Bypass blocked domains or hidden browser permissions on its own.',
  'Run custom scripts unless you explicitly enable Advanced mode and that capability.',
  'Guarantee actions on sites that block extension or debugger access.',
];

export function OnboardingFlow({
  currentStep,
  selectedProviderLabel,
  enabledPermissionCount,
  theme,
  language,
  providerRequiresApiKey,
  providerRequiresEndpoint = false,
  providerUsesAccountImport = false,
  providerStatusLabel,
  providerSetupHint,
  providerReadyHint,
  providerSetupPanel,
  onStepChange,
  onSkip,
  onComplete,
  canComplete = true,
  isBusy = false,
  isCompleting = false,
}: OnboardingFlowProps) {
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === ONBOARDING_STEP_COUNT - 1;

  return (
    <div
      className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgb(var(--color-primary-500)/0.16),_transparent_26%),linear-gradient(180deg,_rgb(var(--color-bg-secondary)),_rgb(var(--color-bg-primary))_26%)] px-4 py-6 sm:px-6 lg:px-8"
      data-testid="onboarding-root"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="overflow-hidden rounded-[28px] border border-border bg-surface-elevated shadow-xl shadow-slate-950/5">
          <div className="flex flex-col gap-5 px-6 py-7 sm:px-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary-500/20 bg-primary-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-primary-700">
                <Sparkles className="h-3.5 w-3.5" />
                Onboarding - Guided setup
              </div>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-content-primary">
                  Set up Flux once, then move into the full control surface.
                </h1>
                <p className="mt-2 text-sm leading-6 text-content-secondary sm:text-base">
                  This four-step flow introduces the extension, connects a provider, explains
                  capability boundaries, and leaves you with practical next moves.
                </p>
              </div>
            </div>

            <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Onboarding progress">
              {ONBOARDING_STEPS.map((step, index) => (
                <li
                  key={step.id}
                  className={[
                    'rounded-2xl border px-4 py-3 text-sm',
                    index === currentStep
                      ? 'border-primary-500/30 bg-primary-50 text-primary-700'
                      : index < currentStep
                        ? 'border-success-500/20 bg-success-50 text-success-700'
                        : 'border-border bg-surface-primary text-content-secondary',
                  ].join(' ')}
                  aria-current={index === currentStep ? 'step' : undefined}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em]">
                    Step {index + 1}
                  </p>
                  <p className="mt-2 font-semibold">{step.label}</p>
                </li>
              ))}
            </ol>
          </div>
        </header>

        <Card className="overflow-hidden border border-border bg-surface-elevated shadow-lg shadow-slate-950/5">
          <CardContent className="space-y-6 px-6 py-6 sm:px-8">
            {currentStep === 0 ? (
              <section
                className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]"
                data-testid="onboarding-step-welcome"
              >
                <div className="space-y-5">
                  <div>
                    <Badge variant="info">Welcome</Badge>
                    <h2 className="mt-3 text-2xl font-semibold tracking-tight text-content-primary">
                      Tell Flux what you want to do, not how to code it.
                    </h2>
                    <p className="mt-3 text-sm leading-7 text-content-secondary sm:text-base">
                      Flux turns natural-language goals into browser actions with provider-backed
                      reasoning, visual guidance, and recoverable execution steps.
                    </p>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-[22px] border border-border bg-surface-primary px-5 py-4">
                      <p className="text-sm font-semibold text-content-primary">Quick setup</p>
                      <p className="mt-2 text-sm leading-6 text-content-secondary">
                        Pick a model provider, keep the risky capabilities scoped, and review the
                        basics before your first workflow.
                      </p>
                    </div>
                    <div className="rounded-[22px] border border-border bg-surface-primary px-5 py-4">
                      <p className="text-sm font-semibold text-content-primary">Visible control</p>
                      <p className="mt-2 text-sm leading-6 text-content-secondary">
                        The side panel, popup, and options page now share the same settings backbone
                        so changes stay coherent.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-4 rounded-[26px] border border-border bg-[linear-gradient(180deg,_rgb(var(--color-bg-secondary)),_rgb(var(--color-bg-primary)))] p-5">
                  <div className="flex items-center gap-3 text-content-primary">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-50 text-primary-700">
                      <WandSparkles className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold">What you will cover</p>
                      <p className="text-sm text-content-secondary">
                        Provider setup, permissions, and launch tips.
                      </p>
                    </div>
                  </div>

                  <ul className="space-y-3 text-sm leading-6 text-content-secondary">
                    <li className="rounded-2xl border border-border bg-surface-elevated px-4 py-3">
                      Choose the AI provider you want to start with.
                    </li>
                    <li className="rounded-2xl border border-border bg-surface-elevated px-4 py-3">
                      Review what Flux can and cannot do on live pages.
                    </li>
                    <li className="rounded-2xl border border-border bg-surface-elevated px-4 py-3">
                      Finish with practical tips before entering the full dashboard.
                    </li>
                  </ul>
                </div>
              </section>
            ) : null}

            {currentStep === 1 ? (
              <section className="space-y-5" data-testid="onboarding-step-connect">
                <div>
                  <Badge variant="warning">Connect AI</Badge>
                  <h2 className="mt-3 text-2xl font-semibold tracking-tight text-content-primary">
                    Start with the provider you trust for your first run.
                  </h2>
                    <p className="mt-3 max-w-3xl text-sm leading-7 text-content-secondary sm:text-base">
                      {providerUsesAccountImport
                        ? 'This onboarding step reuses the live provider setup controls. For Codex, save the provider, unlock the vault, import an official artifact, then validate the active account before you finish onboarding.'
                        : providerRequiresEndpoint
                          ? 'This onboarding step reuses the live provider setup controls. For CLIProxyAPI, the endpoint is mandatory: save the endpoint, keep the API key in the vault, then run Test connection before Flux marks it ready.'
                          : 'This onboarding step reuses the live provider setup controls. For providers with API keys, save the provider and validate the connection before you finish onboarding.'}
                    </p>
                  </div>

                  {providerSetupHint ? (
                    <div className="rounded-[22px] border border-border bg-surface-primary px-5 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-content-tertiary">
                            Current provider state
                          </p>
                          <p className="mt-2 text-lg font-semibold tracking-tight text-content-primary">
                            {providerStatusLabel ?? 'Needs setup'}
                          </p>
                          <p className="mt-2 text-sm leading-6 text-content-secondary">
                            {providerSetupHint}
                          </p>
                        </div>
                        {providerStatusLabel ? (
                          <Badge variant={providerUsesAccountImport ? 'warning' : 'info'}>
                            {providerStatusLabel}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {providerSetupPanel}
                </section>
            ) : null}

            {currentStep === 2 ? (
              <section
                className="grid gap-6 lg:grid-cols-2"
                data-testid="onboarding-step-permissions"
              >
                <div className="space-y-4 rounded-[24px] border border-border bg-surface-primary p-5">
                  <div>
                    <Badge variant="success">Flux can do</Badge>
                    <h2 className="mt-3 text-2xl font-semibold tracking-tight text-content-primary">
                      The safe, visible automation surface.
                    </h2>
                  </div>

                  <ul className="space-y-3 text-sm leading-6 text-content-secondary">
                    {CAN_DO.map((item) => (
                      <li
                        key={item}
                        className="flex items-start gap-3 rounded-2xl border border-border bg-surface-elevated px-4 py-3"
                      >
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-600" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="space-y-4 rounded-[24px] border border-border bg-surface-primary p-5">
                  <div>
                    <Badge variant="error">Flux cannot do</Badge>
                    <h2 className="mt-3 text-2xl font-semibold tracking-tight text-content-primary">
                      Boundaries stay explicit by default.
                    </h2>
                  </div>

                  <ul className="space-y-3 text-sm leading-6 text-content-secondary">
                    {CANNOT_DO.map((item) => (
                      <li
                        key={item}
                        className="flex items-start gap-3 rounded-2xl border border-border bg-surface-elevated px-4 py-3"
                      >
                        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-error-600" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="rounded-2xl border border-border bg-[linear-gradient(180deg,_rgb(var(--color-bg-secondary)),_rgb(var(--color-bg-primary)))] px-4 py-4 text-sm leading-6 text-content-secondary">
                    The current default permission profile keeps{' '}
                    <span className="font-semibold text-content-primary">
                      {enabledPermissionCount}
                    </span>{' '}
                    capabilities enabled. You can fine-tune every toggle later in the full options
                    dashboard.
                  </div>
                </div>
              </section>
            ) : null}

            {currentStep === 3 ? (
              <section
                className="grid gap-6 lg:grid-cols-[1fr_0.95fr]"
                data-testid="onboarding-step-ready"
              >
                <div className="space-y-5">
                  <div>
                    <Badge variant="info">Ready</Badge>
                    <h2 className="mt-3 text-2xl font-semibold tracking-tight text-content-primary">
                      {canComplete
                        ? 'You are ready to move into the full Flux workspace.'
                        : 'Almost ready for the full Flux workspace.'}
                    </h2>
                    <p className="mt-3 max-w-3xl text-sm leading-7 text-content-secondary sm:text-base">
                      {canComplete
                        ? 'The dashboard already knows your current provider and appearance profile, and it carries the current default permission profile forward until you refine the toggles.'
                        : 'Go back to the provider step to finish saving and validating the selected connection before you unlock the full dashboard.'}
                    </p>
                    {providerRequiresApiKey ? (
                      <p className="mt-3 text-sm leading-6 text-content-secondary">
                        {providerRequiresEndpoint
                          ? 'CLIProxyAPI is only considered ready after the saved endpoint and vault-backed API key pass Test connection. Unlock the vault once per browser session before validating or running it.'
                          : 'Key-based providers now store credentials in the encrypted vault. Unlock the vault once per browser session before validating or running those providers.'}
                      </p>
                    ) : null}
                    {providerReadyHint ? (
                      <div className="mt-4 rounded-[22px] border border-border bg-surface-primary px-5 py-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-content-tertiary">
                          Before you finish
                        </p>
                        <p className="mt-2 text-sm leading-6 text-content-secondary">
                          {providerReadyHint}
                        </p>
                      </div>
                    ) : null}
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-[22px] border border-border bg-surface-primary px-5 py-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-content-tertiary">
                        Provider
                      </p>
                      <p className="mt-2 text-lg font-semibold text-content-primary">
                        {selectedProviderLabel}
                      </p>
                    </div>
                    <div className="rounded-[22px] border border-border bg-surface-primary px-5 py-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-content-tertiary">
                        Appearance
                      </p>
                      <p className="mt-2 text-lg font-semibold text-content-primary">
                        {theme} / {language}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-4 rounded-[26px] border border-border bg-[linear-gradient(180deg,_rgb(var(--color-bg-secondary)),_rgb(var(--color-bg-primary)))] p-5">
                  <div className="flex items-center gap-3 text-content-primary">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-50 text-primary-700">
                      <KeyRound className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold">Quick tips</p>
                      <p className="text-sm text-content-secondary">
                        A few useful habits before the first run.
                      </p>
                    </div>
                  </div>

                  <ul className="space-y-3 text-sm leading-6 text-content-secondary">
                    <li className="rounded-2xl border border-border bg-surface-elevated px-4 py-3">
                      Use slash commands in the side panel for common flows like screenshots and
                      extraction.
                    </li>
                    <li className="rounded-2xl border border-border bg-surface-elevated px-4 py-3">
                      Use <span className="font-semibold text-content-primary">Ctrl+Enter</span> to
                      send faster when composing multi-step requests.
                    </li>
                    <li className="rounded-2xl border border-border bg-surface-elevated px-4 py-3">
                      The popup stays useful for quick page checks before you open the full side
                      panel.
                    </li>
                  </ul>
                </div>
              </section>
            ) : null}

            <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
              <Button type="button" variant="ghost" onClick={onSkip} disabled={isBusy}>
                Skip for now
              </Button>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => onStepChange(Math.max(currentStep - 1, 0))}
                  disabled={isFirstStep || isBusy}
                  iconLeft={<ChevronLeft />}
                >
                  Back
                </Button>

                {isLastStep ? (
                  <Button
                    type="button"
                    onClick={onComplete}
                    loading={isCompleting}
                    iconLeft={<CheckCircle2 />}
                    disabled={!canComplete || isBusy}
                  >
                    Finish setup
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={() =>
                      onStepChange(Math.min(currentStep + 1, ONBOARDING_STEP_COUNT - 1))
                    }
                    iconLeft={<ChevronRight />}
                    disabled={isBusy}
                  >
                    Continue
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export type { OnboardingFlowProps };
