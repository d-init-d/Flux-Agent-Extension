import type { AIProviderType, ProviderConfig } from '@shared/types';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const API_RESOURCE_SUFFIXES = ['/v1/chat/completions', '/v1/models'] as const;

export interface ProviderEndpointPolicyResult {
  valid: boolean;
  normalizedEndpoint?: string;
  errorMessage?: string;
}

function trimTrailingSlash(pathname: string): string {
  return pathname.replace(/\/+$/u, '');
}

function normalizeEndpointPath(pathname: string): string {
  const trimmed = trimTrailingSlash(pathname);
  if (!trimmed) {
    return '';
  }

  const lowerPath = trimmed.toLowerCase();
  if (lowerPath.endsWith('/v1')) {
    return trimmed;
  }

  for (const suffix of API_RESOURCE_SUFFIXES) {
    if (lowerPath.endsWith(suffix)) {
      return `${trimmed.slice(0, -suffix.length)}/v1`;
    }
  }

  return trimmed;
}

function normalizeCLIProxyAPIPath(pathname: string): string | null {
  const normalizedPath = normalizeEndpointPath(pathname);
  if (!normalizedPath) {
    return '';
  }

  return normalizedPath.toLowerCase().endsWith('/v1') ? normalizedPath : null;
}

function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

function buildNormalizedUrl(parsed: URL, pathname: string): string {
  return `${parsed.protocol}//${parsed.host}${pathname}`;
}

function getInvalidEndpointMessage(provider: AIProviderType, endpoint: string): string {
  if (!endpoint.trim()) {
    if (provider === 'cliproxyapi') {
      return 'Enter a CLIProxyAPI endpoint. Local docs use http://127.0.0.1:8317 and the API lives under /v1/...';
    }

    if (provider === 'ollama') {
      return 'Enter an Ollama endpoint such as http://localhost:11434.';
    }

    return 'Enter a valid provider endpoint before continuing.';
  }

  if (provider === 'cliproxyapi') {
    return 'Use HTTPS for hosted CLIProxyAPI endpoints, or HTTP only on localhost, 127.0.0.1, or [::1].';
  }

  if (provider === 'ollama') {
    return 'Use an http://localhost, http://127.0.0.1, or http://[::1] Ollama endpoint.';
  }

  return 'Use a valid https:// endpoint before continuing.';
}

export function evaluateProviderEndpointPolicy(
  provider: AIProviderType,
  endpoint: string | undefined,
): ProviderEndpointPolicyResult {
  const rawEndpoint = endpoint?.trim() ?? '';
  if (!rawEndpoint) {
    return {
      valid: false,
      errorMessage: getInvalidEndpointMessage(provider, rawEndpoint),
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawEndpoint);
  } catch {
    return {
      valid: false,
      errorMessage: getInvalidEndpointMessage(provider, rawEndpoint),
    };
  }

  if (provider === 'ollama') {
    if (parsed.protocol !== 'http:' || !isLoopbackHost(parsed.hostname)) {
      return {
        valid: false,
        errorMessage: getInvalidEndpointMessage(provider, rawEndpoint),
      };
    }

    return {
      valid: true,
      normalizedEndpoint: buildNormalizedUrl(parsed, normalizeEndpointPath(parsed.pathname)),
    };
  }

  if (provider === 'cliproxyapi') {
    const allowsProtocol =
      parsed.protocol === 'https:' || (parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname));
    const normalizedPath = normalizeCLIProxyAPIPath(parsed.pathname);
    if (!allowsProtocol || normalizedPath === null) {
      return {
        valid: false,
        errorMessage: getInvalidEndpointMessage(provider, rawEndpoint),
      };
    }

    return {
      valid: true,
      normalizedEndpoint: buildNormalizedUrl(parsed, normalizedPath),
    };
  }

  if (parsed.protocol !== 'https:') {
    return {
      valid: false,
      errorMessage: getInvalidEndpointMessage(provider, rawEndpoint),
    };
  }

  return {
    valid: true,
    normalizedEndpoint: buildNormalizedUrl(parsed, normalizeEndpointPath(parsed.pathname)),
  };
}

export function normalizeProviderEndpoint(
  provider: AIProviderType,
  endpoint: string | undefined,
): string | undefined {
  return evaluateProviderEndpointPolicy(provider, endpoint).normalizedEndpoint;
}

export function normalizeProviderEndpointConfig(
  provider: AIProviderType,
  config: ProviderConfig,
): ProviderConfig {
  const normalizedEndpoint = normalizeProviderEndpoint(provider, config.customEndpoint);
  return {
    ...config,
    customEndpoint: normalizedEndpoint,
  };
}

export function getProviderEndpointHelperText(provider: AIProviderType): string {
  if (provider === 'cliproxyapi') {
    return 'Hosted CLIProxyAPI URLs must use HTTPS. Local HTTP is allowed only for localhost, 127.0.0.1, or [::1]. Paste /v1, /v1/chat/completions, or /v1/models and Flux will normalize it.';
  }

  if (provider === 'ollama') {
    return 'Only loopback HTTP URLs are allowed for local runtime testing. Paste /v1, /v1/chat/completions, or /v1/models and Flux will normalize it.';
  }

  return 'Remote custom endpoints must use HTTPS. Paste /v1, /v1/chat/completions, or /v1/models and Flux will normalize it.';
}
