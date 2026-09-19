const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:8000/api/v1';

function getToken() {
  return localStorage.getItem('santulan_token');
}

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
      ...options.headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(body?.error?.message || 'Request failed');
    error.code = body?.error?.code;
    error.status = res.status;
    error.details = body?.error?.details;
    throw error;
  }
  return body;
}

/**
 * The backend authenticates platform accounts (docs/SQL-Database-Schema.md) and returns the real
 * account role. The screens are named for the assessment roles, so map the two roles that have a
 * landing screen: superuser -> admin, student -> participant. Any other role has no screen yet.
 */
const APP_ROLE_BY_ACCOUNT_ROLE = { superuser: 'admin', student: 'participant' };
export const toAppRole = (accountRole) => APP_ROLE_BY_ACCOUNT_ROLE[accountRole] || null;

/** `identifier` is an email (contains "@") or a school-issued student login ID. */
export async function login(identifier, password) {
  const credentials = identifier.includes('@') ? { email: identifier.trim() } : { loginId: identifier.trim() };
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...credentials, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message || 'Login failed');
  localStorage.setItem('santulan_token', body.token);
  localStorage.setItem('santulan_role', body.user.role);
  localStorage.setItem('santulan_user', JSON.stringify({ name: body.user.name, email: body.user.email, role: body.user.role }));
  return body;
}

export function logout() {
  localStorage.removeItem('santulan_token');
  localStorage.removeItem('santulan_role');
  localStorage.removeItem('santulan_user');
  localStorage.removeItem('santulan_last_control');
}

/** Who is signed in (name/email for the dashboard header); null if unknown. */
export function getUser() {
  try {
    return JSON.parse(localStorage.getItem('santulan_user'));
  } catch (err) {
    return null;
  }
}

/**
 * The API has no "current participation state" read, so the dashboard remembers the last
 * control action recorded from this browser (shown as such, never as the live state).
 */
export function getLastControl() {
  try {
    return JSON.parse(localStorage.getItem('santulan_last_control'));
  } catch (err) {
    return null;
  }
}

export function getRole() {
  return toAppRole(localStorage.getItem('santulan_role'));
}

export const getProfile = () => request('/assessments/profile');
export const declareProfile = (data) => request('/assessments/profile', { method: 'POST', body: JSON.stringify(data) });
export const recordConsent = (data) => request('/assessments/consents', { method: 'POST', body: JSON.stringify(data) });
export const startOrResumeAttempt = () => request('/assessments/attempts', { method: 'POST' });
export const saveResponse = (attemptId, data) =>
  request(`/assessments/attempts/${attemptId}/responses`, { method: 'POST', body: JSON.stringify(data) });
export const pauseAttempt = (attemptId) => request(`/assessments/attempts/${attemptId}/pause`, { method: 'POST' });
export const resumeAttempt = (attemptId) => request(`/assessments/attempts/${attemptId}/resume`, { method: 'POST' });
export const submitAttempt = (attemptId) => request(`/assessments/attempts/${attemptId}/submit`, { method: 'POST' });
export const getScores = (attemptId) => request(`/assessments/attempts/${attemptId}/scores`);
export const getReport = (reportId) => request(`/assessments/reports/${reportId}`);
export const retryReport = (reportId) => request(`/assessments/reports/${reportId}/retry`, { method: 'POST' });

export const importItemPool = async (file) => {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_BASE}/admin/assessments/import`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body: form,
  });
  const body = await res.json();
  if (!res.ok) {
    const error = new Error(body?.error?.message || 'Import failed');
    error.code = body?.error?.code;
    error.details = body?.error?.details;
    throw error;
  }
  return body;
};
export const controlParticipation = async (data) => {
  const body = await request('/admin/assessments/control', { method: 'POST', body: JSON.stringify(data) });
  localStorage.setItem('santulan_last_control', JSON.stringify({ action: body.control.action, reason: body.control.reason, at: body.control.createdAt }));
  return body;
};
export const getSubmissions = () => request('/admin/assessments/submissions');
export const getSubmissionDetail = (attemptId) => request(`/admin/assessments/submissions/${attemptId}`);
export const reviewQualityFlag = (flagId, disposition) =>
  request(`/admin/assessments/quality-flags/${flagId}`, { method: 'PATCH', body: JSON.stringify({ disposition }) });
