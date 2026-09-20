export interface User { id: string; email: string }
export interface RemoteWorkbook { data: unknown | null; revision: number; updatedAt: string | null }

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, any> = {}) {
    super(message);
  }
  get network() {
    return this.status === 0;
  }
}

// Same-origin requests: the session lives in an HttpOnly cookie, so no token ever passes through page code.
async function call<T>(method: string, url: string, body?: string | object, keepalive = false): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      keepalive: keepalive && typeof body === 'string' && body.length < 60_000, // lets a last save finish while the page is closing
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', "Can't reach the server. Check your connection.");
  }
  const json: any = await res.json().catch(() => null);
  if (!res.ok) {
    const e = json && json.error;
    const { error: _e, ...extra } = json || {};
    throw new ApiError(res.status, (e && e.code) || 'error', (e && e.message) || 'Something went wrong. Please try again.', extra);
  }
  return json as T;
}

export interface Api {
  me(): Promise<{ user: User }>;
  signup(email: string, password: string): Promise<{ user: User; recoveryCode: string }>;
  signin(email: string, password: string): Promise<{ user: User }>;
  signout(): Promise<unknown>;
  reset(email: string, code: string, newPassword: string): Promise<{ user: User; recoveryCode: string }>;
  changePassword(currentPassword: string, newPassword: string): Promise<unknown>;
  newRecoveryCode(password: string): Promise<{ recoveryCode: string }>;
  getWorkbook(): Promise<RemoteWorkbook>;
  // body is the JSON text of the workbook, so it is only serialised once
  putWorkbook(dataJson: string, baseRevision: number, force?: boolean, keepalive?: boolean): Promise<{ revision: number }>;
}

export const api: Api = {
  me: () => call('GET', '/api/auth/me'),
  signup: (email, password) => call('POST', '/api/auth/signup', { email, password }),
  signin: (email, password) => call('POST', '/api/auth/signin', { email, password }),
  signout: () => call('POST', '/api/auth/signout'),
  reset: (email, code, newPassword) => call('POST', '/api/auth/reset', { email, code, newPassword }),
  changePassword: (currentPassword, newPassword) => call('POST', '/api/auth/password', { currentPassword, newPassword }),
  newRecoveryCode: (password) => call('POST', '/api/auth/recovery-code', { password }),
  getWorkbook: () => call('GET', '/api/workbook'),
  putWorkbook: (dataJson, baseRevision, force, keepalive) =>
    call('PUT', '/api/workbook', `{"baseRevision":${baseRevision},${force ? '"force":true,' : ''}"data":${dataJson}}`, keepalive),
};
