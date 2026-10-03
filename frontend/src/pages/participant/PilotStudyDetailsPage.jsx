import { Navigate } from 'react-router-dom';

/** Legacy entry point kept for old links; profile fields now live together under Personal information. */
export default function PilotStudyDetailsPage() {
  return <Navigate to="/student/profile" replace />;
}
