import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CircleCheck, Info, TriangleAlert, CircleAlert, X } from 'lucide-react';
import styles from './Toast.module.css';

const ICONS = { success: CircleCheck, info: Info, warning: TriangleAlert, error: CircleAlert };
const ToastContext = createContext(null);

/** Non-blocking confirmations ("Import complete", "Flag reviewed"). Icon + text, auto-dismiss, closable. */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const push = useCallback(
    ({ type = 'info', message, duration }) => {
      nextId.current += 1;
      const id = nextId.current;
      setToasts((list) => [...list, { id, type, message }]);
      const ms = duration ?? (type === 'error' ? 8000 : 5000);
      if (ms > 0) setTimeout(() => dismiss(id), ms);
      return id;
    },
    [dismiss],
  );
  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles.region} role="region" aria-label="Notifications">
        {toasts.map((t) => {
          const Icon = ICONS[t.type] || Info;
          return (
            <div key={t.id} className={`${styles.toast} ${styles[t.type]}`} role={t.type === 'error' ? 'alert' : 'status'}>
              <Icon className={styles.icon} size={20} aria-hidden="true" />
              <span className={styles.message}>{t.message}</span>
              <button type="button" className={styles.dismiss} onClick={() => dismiss(t.id)} aria-label="Dismiss notification">
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

/** Safe outside a provider (no-op), so a component can be rendered on its own. */
export const useToast = () => useContext(ToastContext) || { push: () => 0, dismiss: () => {} };
