/*
 * Layouts: PublicLayout (header + footer, design-system §2.2) and ParticipantShell (sidebar + top bar, §2.4).
 * Footer links point only at pages that exist. The notification bell is intentionally absent (no notification entity, D-05);
 * Resources and Wellbeing are not offered (no canonical source).
 */
import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Menu } from 'lucide-react';
import styles from '../styles/ui.module.css';
import Button from './Button/Button';
import { useSession } from '../services/SessionContext';

export function BrandMark({ to = '/' }) {
  return <Link to={to} className={styles.brand}>Santulan</Link>;
}

/** Only English exists, so it is the only option (multi-language is out of scope). */
export function LanguageSelect() {
  return (
    <label>
      <span className="sr-only">Language</span>
      <select className={styles.langSelect} defaultValue="en" aria-label="Language">
        <option value="en">English</option>
      </select>
    </label>
  );
}

export function PublicHeader() {
  const { session } = useSession();
  const navigate = useNavigate();
  return (
    <header className={styles.header}>
      <BrandMark />
      <nav className={styles.nav} aria-label="Main">
        <Link className={styles.navLink} to="/">Home</Link>
        <Link className={styles.navLink} to="/about">About</Link>
        <Link className={styles.navLink} to="/support">Support</Link>
        <Link className={styles.navLink} to="/login">Sign in</Link>
        <LanguageSelect />
        {session && session.role === 'participant'
          ? <Button onClick={() => navigate('/student')}>My Account</Button>
          : <Button onClick={() => navigate('/get-started')}>Get Started</Button>}
      </nav>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className={styles.footer}>
      <Link className={styles.navLink} to="/about">About</Link>
      <Link className={styles.navLink} to="/get-started">Get Started</Link>
      <Link className={styles.navLink} to="/login">Sign in</Link>
      <Link className={styles.navLink} to="/support">Support</Link>
    </footer>
  );
}

export function PublicLayout({ children }) {
  return (
    <div className={styles.publicPage}>
      <PublicHeader />
      <main className={styles.main}>{children}</main>
      <PublicFooter />
    </div>
  );
}

const SIDE_LINKS = [
  { to: '/student', label: 'Home', end: true },
  { to: '/student/assessment', label: 'Assessment' },
  { to: '/student/results', label: 'My results' },
  { to: '/student/profile', label: 'My profile', end: true },
  { to: '/student/profile/preferences', label: 'Preferences' },
  { to: '/student/privacy', label: 'Privacy & consent' },
  { to: '/student/support', label: 'Support' },
];

export function ParticipantShell({ children }) {
  const { signOut } = useSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.shell}>
      <aside className={`${styles.sidebar} ${open ? styles.sidebarOpen : ''}`} aria-label="Sidebar">
        <BrandMark to="/student" />
        <nav aria-label="Participant">
          {SIDE_LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} onClick={() => setOpen(false)}
              className={({ isActive }) => `${styles.sideLink} ${isActive ? styles.sideLinkActive : ''}`}>{l.label}</NavLink>
          ))}
        </nav>
      </aside>
      <div>
        <div className={styles.topbar}>
          <button type="button" className={`${styles.linkButton} ${styles.menuButton}`} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <Menu aria-hidden="true" size={20} /> <span className="sr-only">Menu</span>
          </button>
          <span className={styles.muted}>Signed in</span>
          <Button variant="quiet-link" onClick={() => { signOut(); navigate('/login', { replace: true }); }}>Sign out</Button>
        </div>
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
