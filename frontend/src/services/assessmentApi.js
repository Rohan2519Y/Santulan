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

export async function login(email, password) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message || 'Login failed');
  localStorage.setItem('santulan_token', body.token);
  localStorage.setItem('santulan_role', body.user.role);
  return body;
}

export function logout() {
  localStorage.removeItem('santulan_token');
  localStorage.removeItem('santulan_role');
}

export function getRole() {
  return localStorage.getItem('santulan_role');
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
export const controlParticipation = (data) => request('/admin/assessments/control', { method: 'POST', body: JSON.stringify(data) });
export const getSubmissions = () => request('/admin/assessments/submissions');
export const getSubmissionDetail = (attemptId) => request(`/admin/assessments/submissions/${attemptId}`);
export const reviewQualityFlag = (flagId, disposition) =>
  request(`/admin/assessments/quality-flags/${flagId}`, { method: 'PATCH', body: JSON.stringify({ disposition }) });
