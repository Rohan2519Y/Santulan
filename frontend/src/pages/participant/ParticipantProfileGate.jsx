import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import styles from '../../styles/ui.module.css';
import Skeleton from '../../components/Skeleton/Skeleton';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import { api } from '../../services/santulanApi';
import { hasRequiredIdentification } from './PersonalInformationForm';

/**
 * Open participants complete Identification immediately after registration or sign-in. Institutional participants are not
 * interrupted because their identifying information is expected to come from the institution roster.
 */
export default function ParticipantProfileGate({ children }) {
  const location = useLocation();
  const [state, setState] = useState({ checking: true, required: false, error: '' });

  useEffect(() => {
    let cancelled = false;
    if (location.pathname === '/student/profile') {
      setState({ checking: false, required: false, error: '' });
      return () => { cancelled = true; };
    }

    setState({ checking: true, required: false, error: '' });
    api.registrationState().then(async (registration) => {
      if (registration.participationRoute !== 'OPEN') return false;
      const details = await api.ownPilotDetails().catch((error) => (error.status === 404 ? null : Promise.reject(error)));
      return !hasRequiredIdentification(details);
    }).then((required) => {
      if (!cancelled) setState({ checking: false, required, error: '' });
    }).catch((error) => {
      if (!cancelled) setState({ checking: false, required: false, error: error.message });
    });
    return () => { cancelled = true; };
  }, [location.pathname]);

  if (state.checking) return <div className={styles.stack} aria-busy="true"><Skeleton /><Skeleton /></div>;
  if (state.error) return <StatusMessage type="error" message={state.error} />;
  if (state.required) return <Navigate to="/student/profile" replace state={{ profileRequired: true }} />;
  return children;
}
