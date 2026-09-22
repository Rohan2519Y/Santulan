/*
 * Layouts: PublicLayout (header + footer, sample screens 01-09) and ParticipantShell (top bar + icon sidebar + footer, samples 10-24).
 * Every link points only at pages that exist. Sample items with no canonical source are left out: the notification bell
 * (no notification entity, D-05), Resources and Wellbeing (no content source), and the social-media icons (no destinations yet).
 * The footer's Privacy / Terms / Safeguarding / Contact all go to Support until the content owner supplies those pages.
 * Below 900 px the public header folds into a menu; below 1024 px the participant sidebar becomes a drawer.
 */
import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, ChartColumn, ClipboardList, House, LifeBuoy, Menu, Settings, UserRound, X } from 'lucide-react';
import styles from '../styles/chrome.module.css';
import Button from './Button/Button';
import Logo from './Logo/Logo';
import ImageSlot from './ImageSlot/ImageSlot';
import { useSession } from '../services/SessionContext';

export function BrandMark({ to = '/' }) {
  return <Logo to={to} />;
}

/** Only English exists, so it is the only option (multi-language is out of scope). */
export function LanguageSelect() {
  return (
    <label className={styles.langWrap}>
      <span className="sr-only">Language</span>
      <select className={styles.langSelect} defaultValue="en" aria-label="Language">
        <option value="en">English</option>
      </select>
      <ChevronDown className={styles.langChevron} size={16} aria-hidden="true" />
    </label>
  );
}

/** `action` = 'register' shows "Register" (login and registration screens); otherwise "Get Started". Signed in: "My Account". */
export function PublicHeader({ action }) {
  const { session } = useSession();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [pathname]);
  const signedIn = Boolean(session && session.role === 'participant');
  const label = signedIn ? 'My Account' : action === 'register' ? 'Register' : 'Get Started';
  const target = signedIn ? '/student' : action === 'register' ? '/register' : '/get-started';
  const linkClass = ({ isActive }) => `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`;
  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Logo />
        <button type="button" className={styles.menuButton} aria-expanded={open} aria-controls="site-menu" onClick={() => setOpen((v) => !v)}>
          {open ? <X size={24} aria-hidden="true" /> : <Menu size={24} aria-hidden="true" />}
          <span className="sr-only">{open ? 'Close menu' : 'Menu'}</span>
        </button>
        <div id="site-menu" className={`${styles.menuWrap} ${open ? styles.menuOpen : ''}`}>
          <nav className={styles.nav} aria-label="Main">
            <NavLink className={linkClass} to="/" end>Home</NavLink>
            <NavLink className={linkClass} to="/about">About</NavLink>
            <NavLink className={linkClass} to="/login">For Institutions</NavLink>
            <NavLink className={linkClass} to="/support">Support</NavLink>
          </nav>
          <div className={styles.headerRight}>
            {!signedIn && <Link className={styles.signIn} to="/login">Sign in</Link>}
            <LanguageSelect />
            <Button size="lg" className={styles.headerAction} onClick={() => navigate(target)}>{label}</Button>
          </div>
        </div>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <div className={styles.footerBrand}><Logo size="sm" /></div>
        <nav className={styles.footerLinks} aria-label="Footer">
          <Link to="/support">Privacy</Link>
          <Link to="/support">Terms</Link>
          <Link to="/support">Safeguarding</Link>
          <Link to="/support">Contact</Link>
        </nav>
        <p className={styles.copyright}>© {new Date().getFullYear()} Santulan. All rights reserved.</p>
      </div>
    </footer>
  );
}

export function PublicLayout({ children, action }) {
  return (
    <div className={styles.page}>
      <PublicHeader action={action} />
      <main className={styles.main}>{children}</main>
      <PublicFooter />
    </div>
  );
}

/** The sidebar entries (samples 10-24). "My Profile" also covers Preferences' sibling, Privacy; Settings opens Preferences. */
const SIDE_LINKS = [
  { to: '/student', label: 'Home', icon: House, match: (p) => p === '/student' },
  { to: '/student/profile', label: 'My Profile', icon: UserRound, match: (p) => p === '/student/profile' || p === '/student/privacy' },
  { to: '/student/assessment', label: 'Assessment', icon: ClipboardList, match: (p) => ['/student/assessment', '/student/complete', '/student/generating', '/student/thanks'].includes(p) },
  { to: '/student/results', label: 'My results', icon: ChartColumn, match: (p) => p === '/student/results' },
  { to: '/student/support', label: 'Support', icon: LifeBuoy, match: (p) => p === '/student/support' },
  { to: '/student/profile/preferences', label: 'Settings', icon: Settings, match: (p) => p === '/student/profile/preferences' },
];

export function ParticipantShell({ children }) {
  const { signOut } = useSession();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className={styles.app}>
      <header className={styles.appTop}>
        <button type="button" className={styles.appMenu} aria-expanded={open} aria-controls="participant-sidebar" onClick={() => setOpen((v) => !v)}>
          <Menu aria-hidden="true" size={24} /> <span className="sr-only">Menu</span>
        </button>
        <Logo to="/student" />
        <div className={styles.appAccount}>
          <Link className={styles.accountLink} to="/student/profile">
            <span className={styles.avatar} aria-hidden="true"><UserRound size={20} /></span>
            <span className={styles.accountText}>My account</span>
          </Link>
          <Button variant="quiet-link" onClick={() => { signOut(); navigate('/login', { replace: true }); }}>Sign out</Button>
        </div>
      </header>
      <div className={styles.appBody}>
        {open && <button type="button" className={styles.scrim} aria-label="Close menu" onClick={() => setOpen(false)} />}
        <aside id="participant-sidebar" className={`${styles.sidebar} ${open ? styles.sidebarOpen : ''}`} aria-label="Sidebar">
          <nav aria-label="Participant" className={styles.sideNav}>
            {SIDE_LINKS.map((l) => {
              const Icon = l.icon;
              const active = l.match(pathname);
              return (
                <Link key={l.to} to={l.to} aria-current={active ? 'page' : undefined} className={`${styles.sideLink} ${active ? styles.sideLinkActive : ''}`}>
                  <Icon size={22} aria-hidden="true" /> <span>{l.label}</span>
                </Link>
              );
            })}
          </nav>
          <div className={styles.sideArt} aria-hidden="true">
            <p className={styles.sideScript}>“Different Journeys. A Brighter Tomorrow.”</p>
            <ImageSlot slot="leafArt" className={styles.leaf} />
          </div>
        </aside>
        <main className={styles.appContent}>{children}</main>
      </div>
      <PublicFooter />
    </div>
  );
}
