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

/* ---------- transport config -----------------------------------------------------------------
   On the web this file needs no setup at all: requests go to the same origin the page was served
   from, and the session lives in an HttpOnly cookie the browser attaches automatically.
   A native app has neither of those, so it calls configureApi() once at startup with the server's
   full URL, and setAuthToken() after signing in so every later request carries the session as
   "Authorization: Bearer <token>" instead (see the server's readBearer / requireAuth). */
let API_BASE = '';
let CREDENTIALS: RequestCredentials = 'same-origin';
let authToken: string | null = null;

export function configureApi(opts: { base?: string; credentials?: RequestCredentials }) {
  if (opts.base !== undefined) API_BASE = opts.base.replace(/\/$/, '');
  if (opts.credentials !== undefined) CREDENTIALS = opts.credentials;
}
export function setAuthToken(token: string | null) {
  authToken = token;
}

async function call<T>(method: string, url: string, body?: string | object, keepalive = false): Promise<T> {
  let res: Response;
  try {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (authToken) headers.authorization = 'Bearer ' + authToken;
    res = await fetch(API_BASE + url, {
      method,
      credentials: CREDENTIALS,
      keepalive: keepalive && typeof body === 'string' && body.length < 60_000, // lets a last save finish while the page is closing
      headers,
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
  // "token" is only meaningful to a native app (see setAuthToken above) — the web build ignores it
  signup(email: string, password: string): Promise<{ user: User; recoveryCode: string; token: string }>;
  signin(email: string, password: string): Promise<{ user: User; token: string }>;
  signout(): Promise<unknown>;
  reset(email: string, code: string, newPassword: string): Promise<{ user: User; recoveryCode: string; token: string }>;
  changePassword(currentPassword: string, newPassword: string): Promise<{ ok: true; token: string }>;
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
