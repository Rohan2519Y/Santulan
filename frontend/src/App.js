import { useState } from 'react';
import './App.css';
import LoginPage from './pages/LoginPage';
import AssessmentPage from './pages/participant/AssessmentPage';
import ResultsPage from './pages/participant/ResultsPage';
import ImportPage from './pages/admin/ImportPage';
import ResultsAdminPage from './pages/admin/ResultsAdminPage';
import { getRole, logout } from './services/assessmentApi';

function AdminLanding() {
  const [tab, setTab] = useState('import');
  return (
    <div>
      <div className="attempt-actions">
        <button type="button" onClick={() => setTab('import')} disabled={tab === 'import'}>
          Import &amp; control
        </button>
        <button type="button" onClick={() => setTab('results')} disabled={tab === 'results'}>
          Submissions
        </button>
      </div>
      {tab === 'import' ? <ImportPage /> : <ResultsAdminPage />}
    </div>
  );
}

function ParticipantLanding() {
  const [submittedResult, setSubmittedResult] = useState(null);

  if (submittedResult) {
    return <ResultsPage attemptId={submittedResult.attempt.id} reportId={submittedResult.report?.id} />;
  }
  return <AssessmentPage onSubmitted={setSubmittedResult} />;
}

export default function App() {
  const [role, setRole] = useState(getRole());

  const handleLogout = () => {
    logout();
    setRole(null);
  };

  if (!role) {
    return <LoginPage onLoggedIn={setRole} />;
  }

  return (
    <div className="App">
      <header className="app-header">
        <span>Santulan</span>
        <button type="button" onClick={handleLogout}>
          Sign out
        </button>
      </header>
      <main>{role === 'admin' ? <AdminLanding /> : <ParticipantLanding />}</main>
    </div>
  );
}
