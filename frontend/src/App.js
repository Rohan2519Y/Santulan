import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import styles from './App.module.css';
import LoginPage from './pages/LoginPage';
import AssessmentPage from './pages/participant/AssessmentPage';
import ResultsPage from './pages/participant/ResultsPage';
import AdminDashboard from './pages/admin/AdminDashboard';
import Button from './components/Button/Button';
import { getRole, logout } from './services/assessmentApi';

const HOME_ROUTE_BY_ROLE = { admin: '/admin', participant: '/student' };

function ParticipantLanding() {
  const [submittedResult, setSubmittedResult] = useState(null);

  if (submittedResult) {
    return <ResultsPage attemptId={submittedResult.attempt.id} reportId={submittedResult.report?.id} />;
  }
  return <AssessmentPage onSubmitted={setSubmittedResult} />;
}

/** Requires the caller to be logged in as `role`; otherwise redirects to login or to their own home route. */
function RequireRole({ role, children }) {
  const currentRole = getRole();
  if (!currentRole) return <Navigate to="/login" replace />;
  if (currentRole !== role) return <Navigate to={HOME_ROUTE_BY_ROLE[currentRole]} replace />;
  return children;
}

function LoginRoute() {
  const navigate = useNavigate();
  const currentRole = getRole();
  if (currentRole) return <Navigate to={HOME_ROUTE_BY_ROLE[currentRole]} replace />;

  return (
    <LoginPage
      onLoggedIn={(role) => {
        navigate(HOME_ROUTE_BY_ROLE[role] || '/login', { replace: true });
      }}
    />
  );
}

function Shell({ children }) {
  const navigate = useNavigate();
  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <span className={styles.brand}>Santulan</span>
        <Button type="button" variant="quiet-link" onClick={handleLogout}>
          Sign out
        </Button>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        <Route
          path="/student"
          element={
            <RequireRole role="participant">
              <Shell>
                <ParticipantLanding />
              </Shell>
            </RequireRole>
          }
        />
        <Route
          path="/admin/*"
          element={
            <RequireRole role="admin">
              <AdminDashboard />
            </RequireRole>
          }
        />
        <Route path="*" element={<Navigate to={HOME_ROUTE_BY_ROLE[getRole()] || '/login'} replace />} />
      </Routes>
    </BrowserRouter>
  );
}
