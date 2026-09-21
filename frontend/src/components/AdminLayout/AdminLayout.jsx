import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Users, Building2, ClipboardList, ShieldAlert, FileText, ListChecks, SlidersHorizontal, Download, ScrollText, ToggleRight, LogOut, Menu, X } from 'lucide-react';
import styles from './AdminLayout.module.css';

export const NAV_ITEMS = [
  { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/admin/participants', label: 'Participants', icon: Users },
  { to: '/admin/institutions', label: 'Institutions', icon: Building2 },
  { to: '/admin/submissions', label: 'Submissions', icon: ClipboardList },
  { to: '/admin/quality-review', label: 'Quality review', icon: ShieldAlert },
  { to: '/admin/reports', label: 'Reports', icon: FileText },
  { to: '/admin/question-sets', label: 'Question sets', icon: ListChecks },
  { to: '/admin/participation', label: 'Assessment control', icon: SlidersHorizontal },
  { to: '/admin/exports', label: 'Research exports', icon: Download },
  { to: '/admin/audit-log', label: 'Audit log', icon: ScrollText },
  { to: '/admin/release-flags', label: 'Release switches', icon: ToggleRight },
];

/**
 * The admin shell: a dark sidebar (off-canvas under 900px), a skip link, the signed-in user,
 * and a main landmark. Pages render inside `children`.
 */
export default function AdminLayout({ user, onSignOut, children }) {
  const [open, setOpen] = useState(false);
  const initials = (user?.name || user?.email || '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

  return (
    <div className={styles.shell}>
      <a href="#admin-main" className={styles.skip}>
        Skip to content
      </a>

      <header className={styles.topbar}>
        <button type="button" className={styles.menuButton} onClick={() => setOpen(true)} aria-label="Open navigation" aria-expanded={open} aria-controls="admin-sidebar">
          <Menu size={22} aria-hidden="true" />
        </button>
        <span className={styles.topbarBrand}>Santulan Admin</span>
      </header>

      <aside id="admin-sidebar" className={`${styles.sidebar} ${open ? styles.sidebarOpen : ''}`.trim()}>
        <div className={styles.brandRow}>
          <span className={styles.brandMark} aria-hidden="true">
            S
          </span>
          <span className={styles.brand}>
            Santulan <span className={styles.brandSub}>Admin</span>
          </span>
          <button type="button" className={styles.closeButton} onClick={() => setOpen(false)} aria-label="Close navigation">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <nav aria-label="Admin">
          <ul className={styles.navList}>
            {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
              <li key={to}>
                <NavLink to={to} end={end} className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ''}`.trim()} onClick={() => setOpen(false)}>
                  <Icon size={18} aria-hidden="true" />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className={styles.footer}>
          <div className={styles.user}>
            <span className={styles.avatar} aria-hidden="true">
              {initials}
            </span>
            <span className={styles.userText}>
              <span className={styles.userName}>{user?.name || 'Administrator'}</span>
              {user?.email && <span className={styles.userEmail}>{user.email}</span>}
            </span>
          </div>
          <button type="button" className={styles.signOut} onClick={onSignOut}>
            <LogOut size={18} aria-hidden="true" />
            Sign out
          </button>
        </div>
      </aside>

      {open && <div className={styles.scrim} onClick={() => setOpen(false)} aria-hidden="true" />}

      <main id="admin-main" className={styles.main} tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
