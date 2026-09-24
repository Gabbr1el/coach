export interface AuthIdentity {
  userId: string;
  authSessionId: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthFlowStateStore {
  put(state: string, value: { codeVerifier: string; expiresAt: number }): Promise<void>;
  take(state: string): Promise<{ codeVerifier: string; expiresAt: number } | undefined>;
}

export type SignupResult = { status: 'verification_required' } | { status: 'authenticated'; tokens: AuthTokens };

export interface AuthBoundary {
  signup(email: string, password: string): Promise<SignupResult>;
  verify(tokenHash: string): Promise<AuthTokens>;
  login(email: string, password: string): Promise<AuthTokens>;
  requestPasswordReset(email: string): Promise<{ state: string }>;
  resetPassword(state: string, code: string, password: string): Promise<void>;
  refresh(refreshToken: string, signal?: AbortSignal): Promise<AuthTokens>;
  healthcheck(): Promise<void>;
  isEmailConfirmed(accessToken: string): Promise<boolean>;
  revokeSession(userId: string, authSessionId: string): Promise<void>;
  revokeAll(userId: string): Promise<void>;
}
