import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { clearSession, getSession, setSession } from './santulanApi';

const SessionContext = createContext({ session: null, signIn: () => {}, signOut: () => {} });

/** Holds the signed-in participant/admin session (token claims only; nothing is persisted beyond the tab). */
export function SessionProvider({ children }) {
  const [session, setState] = useState(() => getSession());
  const signIn = useCallback((token) => { setSession(token); setState(getSession()); }, []);
  const signOut = useCallback(() => { clearSession(); setState(null); }, []);
  const value = useMemo(() => ({ session, signIn, signOut }), [session, signIn, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
