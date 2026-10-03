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
  constructor(message, { status = 0, code = 'NETWORK_ERROR', details = {}, totalProblems } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.totalProblems = totalProblems;
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
        // a FormData body (file upload) sets its own multipart Content-Type with the boundary
        ...(body !== undefined && !(typeof FormData !== 'undefined' && body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(token === undefined ? authHeader() : token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      credentials: 'include',
      body: body === undefined ? undefined : (typeof FormData !== 'undefined' && body instanceof FormData ? body : JSON.stringify(body)),
    });
  } catch (err) {
    throw new ApiError('We could not reach the server. Please check your connection and try again.', { code: 'NETWORK_ERROR' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data && data.error ? data.error : {};
    // VALIDATION_ERROR's own message is always the same generic string ("Request validation failed"); the useful part
    // is in details.issues (one per bad field) - surface the first one instead of the generic string when present.
    const firstIssue = e.code === 'VALIDATION_ERROR' && e.details && Array.isArray(e.details.issues) && e.details.issues[0];
    const message = (firstIssue && `${firstIssue.path ? `${firstIssue.path}: ` : ''}${firstIssue.message}`) || e.message || 'Something went wrong. Please try again.';
    throw new ApiError(message, { status: res.status, code: e.code || 'ERROR', details: e.details || {}, totalProblems: e.totalProblems });
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
  // requestOtp/verifyOtp/declareAge are unused (no real OTP/SMS provider exists): OPEN registration now goes straight
  // to registerOpen below, which returns a Santulan ID + one-time temporary password instead - same pattern as
  // institutional registration. Kept defined, not deleted, for when a real provider is integrated.
  requestOtp: (channel, identity) => call('/auth/request-otp', { method: 'POST', body: { channel, identity }, token: null }),
  verifyOtp: (channel, identity, code) => call('/auth/verify-otp', { method: 'POST', body: { channel, identity, code }, token: null }),
  declareAge: (registrationToken, age, idempotencyKey) =>
    call('/participants/age-declaration', { method: 'POST', body: { age }, token: registrationToken, headers: { 'Idempotency-Key': idempotencyKey } }),
  /** OPEN registration: the participant chooses their own email + password up front - no temporary password, no forced
   * change. Returns { santulanId, isMinor, requiredConsents, accessToken, ... } - already signed in. */
  registerOpen: (age, language, email, password, idempotencyKey) =>
    call('/registrations/open', { method: 'POST', body: { age, language, email, password }, token: null, headers: { 'Idempotency-Key': idempotencyKey } }),
  login: (subject, password) => call('/auth/login', { method: 'POST', body: { subject, password }, token: null }),
  setPassword: (setPasswordToken, newPassword) => call('/auth/set-password', { method: 'POST', body: { newPassword }, token: setPasswordToken }),
  /** OPEN participants only, by email (the email IS their login subject); always resolves (never reveals whether it matched anything), same pattern as the old requestOtp. */
  forgotPassword: (email) => call('/auth/forgot-password', { method: 'POST', body: { email }, token: null }),

  registrationState: () => call('/registration/state'),

  /** Research fields saved from the combined Personal information screen. */
  submitProfile: (body) => call('/participants/profile', { method: 'POST', body }),
  ownProfile: () => call('/participants/profile'),

  /** Identification and background fields saved from the combined Personal information screen. */
  submitPilotDetails: (body) => call('/participants/pilot-details', { method: 'POST', body }),
  ownPilotDetails: () => call('/participants/pilot-details'),

  // consent (participants read; the consent service creates and verifies)
  consentRequirements: () => call('/consents/requirements'),
  consentGate: () => call('/consents/gate'),
  grantConsent: (id) => call(`/consents/${id}/grant`, { method: 'POST', body: {} }),
  withdrawConsent: (id) => call(`/consents/${id}/withdraw`, { method: 'POST', body: {} }),
  /** CR-006-13: one checkbox for an adult's own consent - creates, grants and verifies ADULT_SELF_CONSENT in one call. 422 SELF_CONSENT_NOT_AVAILABLE for a minor (unchanged parent/guardian + assent flow applies to them instead). */
  selfConsent: () => call('/consents/self-consent', { method: 'POST', body: {} }),
  /** CR-006-14: one checkbox for a minor - confirms their own STUDENT_ASSENT and attests PARENT_GUARDIAN_CONSENT on the parent/guardian's behalf, both in one call. 422 PARENT_CONSENT_NOT_APPLICABLE for an adult. */
  minorSelfService: () => call('/consents/minor-self-service', { method: 'POST', body: {} }),

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

  // results: only what the server releases to this participant, read from the released report (the score endpoint is withdrawn)
  report: (id) => call(`/reports/${id}`),
};

// ---------------------------------------------------------------------------------------------- release switches (Super Admin)
export const releaseFlagApi = {
  /** { pilotS2, advancedEvidence, developmentRelease, pathwayRelease }, each { value, changedAt, changedBy, reason }. Server state only. */
  list: () => call('/admin/release-flags'),
  set: (flag, value, reason) => call(`/admin/release-flags/${flag}`, { method: 'POST', body: { value, reason } }),
};

// ---------------------------------------------------------------------------------------------- report wording (Super Admin)
export const wordingApi = {
  /** { set: { setId, versionLabel, revision }, rules: [{ ruleId, domainCode, band, evidenceState, locale, layer, ruleCode, text, version, status, createdAt }] } */
  list: (assessmentVersionId) => call(`/admin/wording?assessmentVersionId=${assessmentVersionId}`),
  add: (payload) => call('/admin/wording', { method: 'POST', body: payload }),
  approve: (ruleId, reason) => call(`/admin/wording/${ruleId}/approve`, { method: 'POST', body: { reason } }),
};

// ---------------------------------------------------------------------------------------------- question sets (Super Admin)
export const questionSetApi = {
  /** Uploads a workbook as a draft set. Only the file and the age group are sent; everything else is decided by the server. */
  upload: (file, ageGroup) => {
    const form = new FormData();
    form.append('ageGroup', ageGroup);
    form.append('file', file);
    return call('/admin/question-sets', { method: 'POST', body: form });
  },
  /** Validates the same way `upload` would, but saves nothing - review the result, then call `upload` with the same
   * file to actually add it. */
  previewUpload: (file, ageGroup) => {
    const form = new FormData();
    form.append('ageGroup', ageGroup);
    form.append('file', file);
    return call('/admin/question-sets/preview', { method: 'POST', body: form });
  },
  list: (filters = {}) => {
    const q = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
    return call(`/admin/question-sets${q ? `?${q}` : ''}`);
  },
  get: (id) => call(`/admin/question-sets/${id}`),
  freeze: (id) => call(`/admin/question-sets/${id}/freeze`, { method: 'POST', body: {} }),
  open: (id, reason) => call(`/admin/question-sets/${id}/open`, { method: 'POST', body: { reason } }),
  close: (id, reason) => call(`/admin/question-sets/${id}/close`, { method: 'POST', body: { reason } }),
  /** Only ever refused for a set that has already been frozen (a frozen set is permanent, CR-006-12); a draft has no reason to give. */
  delete: (id) => call(`/admin/question-sets/${id}/delete`, { method: 'POST', body: {} }),
  /** Shows or hides one question from participants (status ACTIVE/RETIRED) - only on a frozen set. The question's text and options never change either way. */
  setItemStatus: (setId, itemId, status, reason) => call(`/admin/question-sets/${setId}/items/${itemId}/status`, { method: 'POST', body: { status, reason } }),
  /** Per-question option counts and skip counts across every completed attempt of this assessment. */
  responseDistribution: (setId) => call(`/admin/question-sets/${setId}/response-distribution`),
  /** The same data as an .xlsx workbook (needs the bearer token, so it is fetched and saved rather than linked). */
  downloadResponseDistribution: (setId) => saveFile(`/admin/question-sets/${setId}/response-distribution/export`, 'santulan-response-distribution.xlsx', 'The response distribution could not be exported.'),
  downloadUnifiedExport: (setId) => saveFile(`/admin/question-sets/${setId}/unified-export`, 'santulan-unified-report-export.xlsx', 'The report engine export could not be generated.'),
  /** Downloads the blank template (needs the bearer token, so it is fetched and saved rather than linked). */
  downloadTemplate: async () => {
    let res;
    try { res = await fetch(`${API_BASE}/admin/question-sets/template`, { headers: authHeader(), credentials: 'include' }); } catch (err) {
      throw new ApiError('We could not reach the server. Please check your connection and try again.', { code: 'NETWORK_ERROR' });
    }
    if (!res.ok) throw new ApiError('The template could not be downloaded.', { status: res.status, code: 'ERROR' });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'santulan_question_set_template.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};

// ---------------------------------------------------------------------------------------------- admin operations (Super Admin)
const qs = (filters = {}) => {
  const q = new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
  return q ? `?${q}` : '';
};

/** Fetches a file with the bearer token and saves it (a plain link cannot carry the token). Never shows a server path. */
async function saveFile(path, fallbackName, failure) {
  let res;
  try { res = await fetch(`${API_BASE}${path}`, { headers: authHeader(), credentials: 'include' }); } catch (err) {
    throw new ApiError('We could not reach the server. Please check your connection and try again.', { code: 'NETWORK_ERROR' });
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError((data.error && data.error.message) || failure, { status: res.status, code: (data.error && data.error.code) || 'ERROR' });
  }
  const disposition = res.headers.get('Content-Disposition') || '';
  const named = /filename="([^"]+)"/.exec(disposition);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = named ? named[1] : fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const adminApi = {
  monitoring: () => call('/admin/monitoring/summary'),
  dashboard: (filters) => call(`/admin/dashboard${qs(filters)}`),
  control: () => call('/admin/assessment-control'),
  setControl: (state, reason) => call('/admin/assessment-control', { method: 'POST', body: { state, ...(reason ? { reason } : {}) } }),

  institutions: () => call('/admin/institutions'),
  createInstitution: (body) => call('/admin/institutions', { method: 'POST', body }),
  updateInstitution: (id, body) => call(`/admin/institutions/${id}`, { method: 'PATCH', body }),
  createCohort: (body) => call('/admin/cohorts', { method: 'POST', body }),
  updateCohort: (id, body) => call(`/admin/cohorts/${id}`, { method: 'PATCH', body }),

  participants: (filters) => call(`/admin/participants${qs(filters)}`),
  setParticipantStatus: (id, status, reason) => call(`/admin/participants/${id}/status`, { method: 'POST', body: { status, reason } }),
  resetCredential: (id) => call(`/admin/participants/${id}/credential-reset`, { method: 'POST', body: {} }),

  /** Roster import: mode 'validate' returns row errors and writes nothing; 'commit' is all-or-nothing after a clean validate. */
  importRoster: (file, { institutionId, cohortId, mode }) => {
    const form = new FormData();
    form.append('institutionId', institutionId);
    form.append('cohortId', cohortId);
    form.append('mode', mode);
    form.append('roster', file);
    return call('/cohorts/import', { method: 'POST', body: form });
  },
  downloadCredentials: (importId) => saveFile(`/admin/credentials/export/${importId}`, 'santulan-credentials.csv', 'The credential file is unavailable or was already downloaded.'),

  submissions: (filters) => call(`/admin/submissions${qs(filters)}`),
  submission: (attemptId) => call(`/admin/submissions/${attemptId}`),
  submissionResponses: (attemptId) => call(`/admin/submissions/${attemptId}/responses`),
  downloadSubmissionResponses: (attemptId) => saveFile(`/admin/submissions/${attemptId}/responses/export`, `santulan-answers-${attemptId}.csv`, 'The answers could not be exported.'),
  /** Draft PDF from the ported pilot-kit report engine (separate from the platform's own in-app report). */
  downloadPilotReportPdf: (attemptId) => saveFile(`/admin/attempts/${attemptId}/pilot-report`, `santulan-pilot-report-${attemptId}.pdf`, 'The pilot report could not be generated.'),
  qualityFlags: (filters) => call(`/admin/quality-flags${qs(filters)}`),
  reviewFlag: (flagId, disposition, note) => call(`/admin/quality-flags/${flagId}`, { method: 'PATCH', body: { disposition, ...(note ? { note } : {}) } }),
  retryReport: (reportId) => call(`/internal/reports/${reportId}/retry`, { method: 'POST', body: {} }),
  auditLogs: (filters) => call(`/admin/audit-logs${qs(filters)}`),

  exports: () => call('/research-exports'),
  requestExport: (body, idempotencyKey) => call('/research-exports', { method: 'POST', body, headers: { 'Idempotency-Key': idempotencyKey } }),
  exportStatus: (exportId) => call(`/research-exports/${exportId}`),
  downloadExport: (exportId) => saveFile(`/research-exports/${exportId}/download`, 'santulan_research_export.xlsx', 'The export could not be downloaded.'),
};
