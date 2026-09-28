import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { SessionProvider, useSession } from './services/SessionContext';
import { ParticipantShell } from './components/layouts';
import { HomePage, AboutPage, GetStartedPage, SupportPage } from './pages/public/PublicPages';
import RegisterPage from './pages/register/RegisterPage';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/participant/DashboardPage';
import AssessmentPage from './pages/participant/AssessmentPage';
import ValidationProfilePage from './pages/participant/ValidationProfilePage';
import { AssessmentCompletePage, GeneratingReportPage } from './pages/participant/AfterSubmitPages';
import ResultsPage from './pages/participant/ResultsPage';
import { ProfilePage, PreferencesPage, ThanksPage, PrivacyPage, ParticipantSupport } from './pages/participant/AccountPages';
import AdminDashboard from './pages/admin/AdminDashboard';

const HOME_BY_ROLE = { participant: '/student', admin: '/admin' };

/** Requires a session of `role` (claims participantId / adminUserId); otherwise sends the visitor to sign in or to their own home. */
function RequireRole({ role, children }) {
  const { session } = useSession();
  if (!session) return <Navigate to="/login" replace />;
  if (session.role !== role) return <Navigate to={HOME_BY_ROLE[session.role] || '/login'} replace />;
  return children;
}

function ParticipantLayout() {
  return <ParticipantShell><Outlet /></ParticipantShell>;
}

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/get-started" element={<GetStartedPage />} />
          <Route path="/support" element={<SupportPage />} />
          <Route path="/register/*" element={<RegisterPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/student" element={<RequireRole role="participant"><ParticipantLayout /></RequireRole>}>
            <Route index element={<DashboardPage />} />
            <Route path="validation-profile" element={<ValidationProfilePage />} />
            <Route path="assessment" element={<AssessmentPage />} />
            <Route path="complete" element={<AssessmentCompletePage />} />
            <Route path="generating" element={<GeneratingReportPage />} />
            <Route path="results" element={<ResultsPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="profile/preferences" element={<PreferencesPage />} />
            <Route path="thanks" element={<ThanksPage />} />
            <Route path="privacy" element={<PrivacyPage />} />
            <Route path="support" element={<ParticipantSupport />} />
          </Route>
          <Route path="/admin/*" element={<RequireRole role="admin"><AdminDashboard /></RequireRole>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  );
}
