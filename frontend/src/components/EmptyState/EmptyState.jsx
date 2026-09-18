import { Inbox } from 'lucide-react';
import styles from './EmptyState.module.css';

export default function EmptyState({ icon: Icon = Inbox, message, action, className = '' }) {
  return (
    <div className={`${styles.empty} ${className}`.trim()}>
      <Icon className={styles.icon} aria-hidden="true" size={32} />
      <p className={styles.message}>{message}</p>
      {action}
    </div>
  );
}
