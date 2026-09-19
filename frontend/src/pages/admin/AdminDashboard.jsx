import { useCallback, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { getSubmissions, getUser, logout } from '../../services/assessmentApi';
import AdminLayout from '../../components/AdminLayout/AdminLayout';
import { ToastProvider } from '../../components/Toast/Toast';
import OverviewPage from './OverviewPage';
import SubmissionsPage from './SubmissionsPage';
import ItemPoolsPage from './ItemPoolsPage';
import ParticipationPage from './ParticipationPage';

/**
 * The admin dashboard: one shell, four pages, one shared submissions fetch (Overview and
 * Submissions read the same data, so their numbers always agree).
 */
export default function AdminDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState({ status: 'loading', submissions: [], error: null, updatedAt: null });

  const load = useCallback(async () => {
    setData((d) => ({ ...d, status: 'loading', error: null }));
    try {
      const res = await getSubmissions();
      setData({ status: 'ready', submissions: res.submissions, error: null, updatedAt: new Date() });
    } catch (err) {
      setData((d) => ({ ...d, status: 'error', error: err.message }));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const signOut = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const shared = { submissions: data.submissions, status: data.status, error: data.error, updatedAt: data.updatedAt, onRefresh: load };

  return (
    <ToastProvider>
      <AdminLayout user={getUser()} onSignOut={signOut}>
        <Routes>
          <Route index element={<OverviewPage {...shared} />} />
          <Route path="submissions" element={<SubmissionsPage {...shared} />} />
          <Route path="item-pools" element={<ItemPoolsPage />} />
          <Route path="participation" element={<ParticipationPage />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </AdminLayout>
    </ToastProvider>
  );
}
