/*
 * Typed wrappers for the canonical API (specs/005 contracts/api.md §2-§5). Rules enforced here, not left to callers:
 *  - the participant is identified by the bearer token only; a participantId, version id, age-at-attempt or score field is
 *    never put in a request body;
 *  - registration and response/submit writes carry an idempotency key that the CALLER creates once per logical action and
 *    reuses on every retry;
 *  - the session token lives in sessionStorage (cleared when the tab closes).
 */
const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:8000/api/v1';
const SESSION_KEY = 'santulan.session';

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'NETWORK_ERROR', details = {} } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------------------------- session
function decodeClaims(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(payload))));
  } catch (err) {
    return null;
  }
}

export function getSession() {
  try {
    const token = sessionStorage.getItem(SESSION_KEY);
    if (!token) return null;
    const claims = decodeClaims(token);
    if (!claims || (claims.exp && claims.exp * 1000 < Date.now())) return null;
    return { token, role: claims.role, participantId: claims.participantId || null, adminUserId: claims.adminUserId || null };
  } catch (err) {
    return null;
  }
}
export const setSession = (token) => { try { sessionStorage.setItem(SESSION_KEY, token); } catch (err) { /* storage unavailable: the session lasts for this page only */ } };
export const clearSession = () => { try { sessionStorage.removeItem(SESSION_KEY); } catch (err) { /* nothing to clear */ } };

// ---------------------------------------------------------------------------------------------- transport
async function call(path, { method = 'GET', body, token, headers = {} } = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token === undefined ? authHeader() : token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      credentials: 'include',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ApiError('We could not reach the server. Please check your connection and try again.', { code: 'NETWORK_ERROR' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data && data.error ? data.error : {};
    throw new ApiError(e.message || 'Something went wrong. Please try again.', { status: res.status, code: e.code || 'ERROR', details: e.details || {} });
  }
  return data;
}
const authHeader = () => { const s = getSession(); return s ? { Authorization: `Bearer ${s.token}` } : {}; };

export const newKey = (prefix = 'k') => {
  const random = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
};

// ---------------------------------------------------------------------------------------------- identity and registration
export const api = {
  routeAge: (age) => call('/registration/route', { method: 'POST', body: { age }, token: null }),
  requestOtp: (channel, identity) => call('/auth/request-otp', { method: 'POST', body: { channel, identity }, token: null }),
  verifyOtp: (channel, identity, code) => call('/auth/verify-otp', { method: 'POST', body: { channel, identity, code }, token: null }),
  /** The registration (purpose) token comes from verifyOtp; the age is the ONLY personal value sent. */
  declareAge: (registrationToken, age, idempotencyKey) =>
    call('/participants/age-declaration', { method: 'POST', body: { age }, token: registrationToken, headers: { 'Idempotency-Key': idempotencyKey } }),
  login: (subject, password) => call('/auth/login', { method: 'POST', body: { subject, password }, token: null }),
  setPassword: (setPasswordToken, newPassword) => call('/auth/set-password', { method: 'POST', body: { newPassword }, token: setPasswordToken }),

  registrationState: () => call('/registration/state'),

  // consent (participants read; the consent service creates and verifies)
  consentRequirements: () => call('/consents/requirements'),
  consentGate: () => call('/consents/gate'),
  grantConsent: (id) => call(`/consents/${id}/grant`, { method: 'POST', body: {} }),
  withdrawConsent: (id) => call(`/consents/${id}/withdraw`, { method: 'POST', body: {} }),

  // delivery (BUILD 05)
  createAttempt: () => call('/attempts', { method: 'POST', body: {} }),
  attempt: (id) => call(`/attempts/${id}`),
  items: (id) => call(`/attempts/${id}/items`),
  responses: (id) => call(`/attempts/${id}/responses`),
  resume: (id) => call(`/attempts/${id}/sessions/resume`, { method: 'POST', body: {} }),
  pause: (id, reason) => call(`/attempts/${id}/pause`, { method: 'POST', body: reason ? { reason } : {} }),
  saveResponse: (id, { itemId, value, idempotencyKey, responseTimeMs, presentedOrder }) => call(`/attempts/${id}/responses`, {
    method: 'POST',
    body: { itemId, value: String(value), idempotencyKey, ...(responseTimeMs != null ? { responseTimeMs } : {}), ...(presentedOrder != null ? { presentedOrder } : {}) },
  }),
  submit: (id, submissionKey) => call(`/attempts/${id}/submit`, { method: 'POST', body: { submissionKey } }),

  // results: only what the server releases to this participant
  scores: (id) => call(`/attempts/${id}/scores`),
};
