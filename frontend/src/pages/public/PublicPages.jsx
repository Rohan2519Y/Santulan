/*
 * Public pages (screens 01-03 + the static Support page). Copy is neutral placeholder text flagged TODO(copy): approved wording
 * comes from the content owner. Nothing here claims validation, diagnosis or comparison. Institutional participants do not
 * self-join by code (decision D-02): that route leads to sign-in with a Santulan ID and temporary password.
 */
import { Link } from 'react-router-dom';
import styles from '../../styles/ui.module.css';
import { PublicLayout } from '../../components/layouts';
import { ButtonLink, CheckList, RailCard, SplitHero } from '../../components/participantKit';

/* TODO(copy): all headings and sentences below are placeholders until the content owner supplies approved text. */

export function HomePage() {
  return (
    <PublicLayout>
      <SplitHero aside={(
        <>
          <p className={styles.script}>Take your time.</p>
          <p className={styles.muted}>There are no right or wrong answers. Your answers are kept private and are not shared with anyone without the consents described when you register.</p>
        </>
      )}>
        <p className={styles.eyebrow}>Santulan</p>
        <h1 className={styles.h1}>A calm way to understand your strengths</h1>
        <p className={styles.lead}>Santulan helps young people aged 13 to 25 reflect on seven areas of everyday capability, at their own pace, across up to four sittings.</p>
        <div className={styles.row}>
          <Link className={styles.pageLink} to="/get-started">Get started</Link>
          <Link className={styles.pageLink} to="/login">Sign in with a Santulan ID</Link>
        </div>
      </SplitHero>
    </PublicLayout>
  );
}

export function AboutPage() {
  return (
    <PublicLayout>
      <h1 className={styles.h2}>About Santulan</h1>
      <p className={styles.lead}>Santulan is a reflective assessment. It describes what you told us about yourself in seven areas; it does not label you or compare you with other people.</p>
      <div className={styles.grid2}>
        <RailCard tone="sky" title="How it works">
          <p>You register, complete the required consent steps, answer at your own pace over up to four sessions, and then receive a report when it is ready.</p>
        </RailCard>
        <RailCard tone="safe" title="Your information is safe">
          <p>We do not ask for your name or school. You are identified by a Santulan ID.</p>
        </RailCard>
      </div>
    </PublicLayout>
  );
}

export function GetStartedPage() {
  return (
    <PublicLayout>
      <div className={styles.center}>
        <p className={styles.eyebrow}>Get started</p>
        <h1 className={styles.h1}>Choose your participation route</h1>
        <p className={`${styles.lead} ${styles.centerLead}`}>Santulan is available through two routes. Select the option that applies to you.</p>
      </div>
      <div className={styles.grid2}>
        <section className={`${styles.card} ${styles.toneGreen}`} aria-labelledby="route-open">
          <p className={styles.eyebrow}>Open route</p>
          <h2 id="route-open" className={styles.h3}>Register on your own</h2>
          <p>For people who are not part of a school or college group.</p>
          <CheckList items={['Register with an email address or mobile number', 'Confirm your age and consent', 'Get your Santulan ID and start']} />
          <ButtonLink to="/register" variant="route-open" icon>Register</ButtonLink>
        </section>
        <section className={`${styles.card} ${styles.toneBlue}`} aria-labelledby="route-institution">
          <p className={`${styles.eyebrow} ${styles.eyebrowInstitution}`}>Institution route</p>
          <h2 id="route-institution" className={styles.h3}>My school or college registered me</h2>
          <p>Your coordinator gives you a Santulan ID and a temporary password.</p>
          <CheckList items={['Sign in with your Santulan ID', 'Use your temporary password once', 'Choose a new password and continue']} />
          <ButtonLink to="/login" variant="route-institution" icon>Sign in with a Santulan ID</ButtonLink>
        </section>
      </div>
      <div className={`${styles.card} ${styles.toneSky} ${styles.helpStrip}`}>
        <div>
          <h2 className={styles.h3}>Not sure which route to choose?</h2>
          <p>If your school, college or organisation invited you, use the institution route. Otherwise you can register on your own.</p>
        </div>
        <div>
          <h2 className={styles.h3}>Need help?</h2>
          <p>Visit <Link className={styles.pageLink} to="/support">Support</Link> for assistance.</p>
        </div>
      </div>
    </PublicLayout>
  );
}

/** Static support page (approved contact and safeguarding text is pending: TODO(copy)). */
export function SupportPage({ embedded = false }) {
  const body = (
    <>
      <h1 className={styles.h2}>Support</h1>
      <p className={styles.lead}>If something is worrying you, or you need help using Santulan, please talk to someone you trust, such as a parent, guardian, teacher or coordinator.</p>
      <RailCard tone="help" title="Need help?">
        <p>Approved support and safeguarding contact details will appear here. TODO(copy): contact details are provided by the programme owner.</p>
      </RailCard>
    </>
  );
  return embedded ? body : <PublicLayout>{body}</PublicLayout>;
}
