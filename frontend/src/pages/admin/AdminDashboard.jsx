import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useSession } from '../../services/SessionContext';
import AdminLayout from '../../components/AdminLayout/AdminLayout';
import { ToastProvider } from '../../components/Toast/Toast';
import OverviewPage from './OverviewPage';
import ParticipantsPage from './ParticipantsPage';
import InstitutionsPage from './InstitutionsPage';
import RosterImportPage from './RosterImportPage';
import SubmissionsPage from './SubmissionsPage';
import QualityReviewPage from './QualityReviewPage';
import ReportsPage from './ReportsPage';
import QuestionSetsPage from './QuestionSetsPage';
import ResponseDistributionPage from './ResponseDistributionPage';
import ParticipationPage from './ParticipationPage';
import ExportsPage from './ExportsPage';
import AuditLogPage from './AuditLogPage';
import ReleaseFlagsPage from './ReleaseFlagsPage';

/**
 * The admin dashboard: one shell, one page per job. Every page reads its own data from the server (counts, lists and state are never
 * kept or computed in the browser), so what an administrator sees is always what the platform holds.
 */
export default function AdminDashboard() {
  const navigate = useNavigate();
  const { signOut: endSession } = useSession();
  const signOut = () => {
    endSession();
    navigate('/login', { replace: true });
  };

  return (
    <ToastProvider>
      <AdminLayout user={{ name: 'Administrator' }} onSignOut={signOut}>
        <Routes>
          <Route index element={<OverviewPage />} />
          <Route path="participants" element={<ParticipantsPage />} />
          <Route path="institutions" element={<InstitutionsPage />} />
          <Route path="roster-import" element={<RosterImportPage />} />
          <Route path="submissions" element={<SubmissionsPage />} />
          <Route path="quality-review" element={<QualityReviewPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="question-sets" element={<QuestionSetsPage />} />
          <Route path="response-distribution" element={<ResponseDistributionPage />} />
          <Route path="participation" element={<ParticipationPage />} />
          <Route path="exports" element={<ExportsPage />} />
          <Route path="audit-log" element={<AuditLogPage />} />
          <Route path="release-flags" element={<ReleaseFlagsPage />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </AdminLayout>
    </ToastProvider>
  );
}
