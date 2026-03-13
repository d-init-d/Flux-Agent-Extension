/**
 * @module core/auth/github-device-flow
 * @description GitHub Device Flow OAuth for GitHub Copilot integration.
 *
 * Implements RFC 8628 (OAuth 2.0 Device Authorization Grant) to obtain a
 * GitHub access token that can be exchanged for a Copilot session token.
 *
 * Flow:
 *  1. Request a device code from GitHub
 *  2. User visits verification URL and enters the user code
 *  3. Poll GitHub for the access token
 *  4. Exchange the access token for a Copilot API token
 *
 * @see https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
 */

const GITHUB_CLIENT_ID = 'Iv1.b507a08c87ecfe98';

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface CopilotToken {
  token: string;
  expires_at: number;
}

export interface DeviceFlowCallbacks {
  onUserCode: (userCode: string, verificationUri: string) => void;
  onPolling?: () => void;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Device Flow Implementation
// ---------------------------------------------------------------------------

export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const response = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      scope: 'copilot',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to request device code: ${response.status} ${text}`);
  }

  return response.json() as Promise<DeviceCodeResponse>;
}

export async function pollForAccessToken(
  deviceCode: string,
  interval: number,
  signal?: AbortSignal,
): Promise<string> {
  let pollInterval = interval;

  for (;;) {
    if (signal?.aborted) {
      throw new Error('Device flow cancelled by user');
    }

    await sleep(pollInterval * 1000);

    if (signal?.aborted) {
      throw new Error('Device flow cancelled by user');
    }

    const response = await fetch(ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });

    const data = (await response.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (data.access_token) {
      return data.access_token;
    }

    if (data.error === 'authorization_pending') {
      continue;
    }

    if (data.error === 'slow_down') {
      pollInterval += 5;
      continue;
    }

    if (data.error === 'expired_token') {
      throw new Error('Device code expired. Please restart the authentication flow.');
    }

    throw new Error(data.error_description ?? data.error ?? 'Unknown OAuth error');
  }
}

/**
 * Run the full device flow: request code → show to user → poll → return token.
 */
export async function runDeviceFlow(callbacks: DeviceFlowCallbacks): Promise<string> {
  const deviceCode = await requestDeviceCode();

  callbacks.onUserCode(deviceCode.user_code, deviceCode.verification_uri);

  const accessToken = await pollForAccessToken(
    deviceCode.device_code,
    deviceCode.interval,
    callbacks.signal,
  );

  return accessToken;
}

/**
 * Exchange a GitHub access token for a short-lived Copilot API token.
 */
export async function exchangeCopilotToken(
  githubAccessToken: string,
): Promise<CopilotToken> {
  const response = await fetch(COPILOT_TOKEN_URL, {
    headers: {
      Authorization: `token ${githubAccessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('GitHub token is invalid or expired. Please re-authenticate.');
    }
    if (response.status === 403) {
      throw new Error(
        'Your GitHub account does not have an active Copilot subscription.',
      );
    }
    const text = await response.text();
    throw new Error(`Failed to get Copilot token: ${response.status} ${text}`);
  }

  const data = (await response.json()) as {
    token: string;
    expires_at: string;
  };

  return {
    token: data.token,
    expires_at: new Date(data.expires_at).getTime(),
  };
}

/**
 * Validate that a GitHub access token has Copilot access.
 */
export async function validateCopilotAccess(
  githubAccessToken: string,
): Promise<boolean> {
  try {
    await exchangeCopilotToken(githubAccessToken);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
