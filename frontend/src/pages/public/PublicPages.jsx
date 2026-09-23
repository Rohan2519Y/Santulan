/*
 * Public pages (screens 01-03 + the static Support page). Copy is neutral placeholder text flagged TODO(copy): approved wording
 * comes from the content owner. Nothing here claims validation, diagnosis or comparison. Institutional participants do not
 * self-join by code (decision D-02): that route leads to sign-in with a Santulan ID and temporary password.
 * Every photo is an ImageSlot (white until a path is set in assets/imageSlots.js).
 */
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, ChartColumn, CircleHelp, Globe, Headphones, Landmark, Sprout, ShieldCheck, Users, UserRound, Building2, Leaf } from 'lucide-react';
import styles from '../../styles/ui.module.css';
import s from '../../styles/site.module.css';
import { PublicLayout } from '../../components/layouts';
import ImageSlot from '../../components/ImageSlot/ImageSlot';
import { ButtonLink, CheckList, IconBadge, RailCard } from '../../components/participantKit';

/* TODO(copy): all headings and sentences below are placeholders until the content owner supplies approved text. */

const VALUES = [
  { icon: ChartColumn, tone: 'blue', title: 'Thoughtfully Built', text: 'Designed around seven areas of everyday capability' },
  { icon: Users, tone: 'blue', title: 'Age-Appropriate', text: 'Designed for adolescents and emerging adults' },
  { icon: ShieldCheck, tone: 'green', title: 'Safe & Secure', text: 'Your privacy and well-being come first' },
  { icon: Sprout, tone: 'green', title: 'Growth Focused', text: 'Support for real development' },
];

export function HomePage() {
  return (
    <PublicLayout>
      <section className={s.homeHero}>
        <ImageSlot slot="homeHero" className={s.homeHeroImg} />
        <div className={s.homeHeroShade} aria-hidden="true" />
        <div className={s.homeHeroInner}>
          <div className={s.homeCopy}>
            <h1 className={s.homeTitle}>A More Balanced Tomorrow</h1>
            <p className={s.homeSub}>Starts with Understanding Today</p>
            <p className={s.homeLead}>Santulan is a well-being reflection and development platform for adolescents and emerging adults.</p>
            <div className={s.ctaRow}>
              <ButtonLink to="/get-started" size="lg" icon block={false}>Get Started</ButtonLink>
              <ButtonLink to="/about" variant="secondary" size="lg" block={false} className={s.onPhotoOutline}>Learn More</ButtonLink>
            </div>
          </div>
          <p className={s.homeScript} aria-hidden="true">Same You.<br />A Brighter<br />Tomorrow.</p>
          <ul className={s.valueRow}>
            {VALUES.map((v) => (
              <li key={v.title} className={s.value}>
                <IconBadge icon={v.icon} tone={v.tone} size="sm" />
                <p className={s.valueTitle}>{v.title}</p>
                <p className={s.valueText}>{v.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={s.band}>
        <div className={s.container}>
          <h2 className={s.bandTitle}>Supporting Young People at Every Step</h2>
          <p className={s.bandLead}>Understand your strengths. Explore new possibilities. Take meaningful steps towards a more balanced and fulfilling future.</p>
          <div className={s.trio}>
            {[
              { icon: BookOpen, tone: 'green', title: 'Understand', text: 'Gain insights into your well-being across key areas of life.' },
              { icon: Leaf, tone: 'pink', title: 'Grow', text: 'Explore ideas and practical steps for development.' },
              { icon: Users, tone: 'lavender', title: 'Thrive', text: 'Build the skills and confidence for what’s next.' },
            ].map((c) => (
              <article key={c.title} className={s.trioCard}>
                <IconBadge icon={c.icon} tone={c.tone} size="lg" />
                <div>
                  <h3 className={s.trioTitle}>{c.title}</h3>
                  <p className={s.trioText}>{c.text}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}

export function AboutPage() {
  return (
    <PublicLayout>
      <section className={s.aboutHero}>
        <div className={s.aboutCopy}>
          <p className={s.aboutEyebrow}>About Santulan</p>
          <h1 className={s.aboutTitle}>A Reflective Approach to a Brighter Tomorrow</h1>
          <p className={s.aboutLead}>Santulan is a well-being reflection and development platform designed for adolescents and emerging adults. It describes what you told us about yourself in seven areas; it does not label you or compare you with other people.</p>
          <blockquote className={s.quoteBar}>“Greater self-awareness today, a more confident you tomorrow.”</blockquote>
        </div>
        <ImageSlot slot="aboutHero" className={s.aboutImg} />
      </section>

      <section className={s.valueStrip}>
        <ul className={s.valueStripInner}>
          {[
            { icon: ChartColumn, tone: 'blue', title: 'Thoughtfully Built', text: 'Seven areas of everyday capability' },
            { icon: Sprout, tone: 'green', title: 'Development Focused', text: 'Support for real-life growth' },
            { icon: Users, tone: 'pink', title: 'Age-Appropriate', text: 'Designed for adolescents and emerging adults' },
            { icon: ShieldCheck, tone: 'lavender', title: 'Safe & Secure', text: 'Your privacy and well-being come first' },
          ].map((v) => (
            <li key={v.title} className={s.valueStripItem}>
              <IconBadge icon={v.icon} tone={v.tone} />
              <div><p className={s.stripTitle}>{v.title}</p><p className={s.stripText}>{v.text}</p></div>
            </li>
          ))}
        </ul>
      </section>

      <section className={s.container}>
        <div className={s.aboutLower}>
          <div className={s.visionCard}>
            <h2 className={s.cardTitle}>Our Vision</h2>
            <p>A future where every young person has the self-understanding, confidence and support to lead a more balanced, purposeful and fulfilling life.</p>
            <span className={s.rule} aria-hidden="true" />
            <div className={s.visionRow}>
              <span className={s.visionItem}><IconBadge icon={UserRound} tone="blue" size="sm" /> Individuals Thrive</span>
              <span className={s.visionItem}><IconBadge icon={Building2} tone="green" size="sm" /> Communities Flourish</span>
              <span className={s.visionItem}><IconBadge icon={Globe} tone="lavender" size="sm" /> A Healthier Tomorrow</span>
            </div>
          </div>
          <div>
            <h2 className={s.cardTitle}>Our Approach</h2>
            <ol className={s.approach}>
              {[
                ['Understand', 'Gain insights into your strengths and areas to explore.', 'blue'],
                ['Grow', 'Take practical steps with guidance that fits you.', 'green'],
                ['Thrive', 'Build skills, confidence and well-being for what’s next.', 'lavender'],
              ].map(([t, d, tone], i) => (
                <li key={t} className={s.approachItem}>
                  <span className={`${s.approachNo} ${s[`no_${tone}`]}`} aria-hidden="true">{`0${i + 1}`}</span>
                  <div><h3 className={s.approachTitle}>{t}</h3><p className={s.approachText}>{d}</p></div>
                </li>
              ))}
            </ol>
          </div>
          <figure className={s.teamQuote}>
            <p>“Santulan helps young people pause, reflect and take charge of their growth journey — with compassion and clarity.”</p>
            <span className={s.rule} aria-hidden="true" />
            <figcaption>The Santulan Team</figcaption>
          </figure>
        </div>
      </section>
    </PublicLayout>
  );
}

export function GetStartedPage() {
  return (
    <PublicLayout>
      <section className={s.routeHero}>
        <div className={s.routeHead}>
          <div className={s.routeTitleBlock}>
            <p className={s.routeEyebrow}>Get started</p>
            <h1 className={s.routeTitle}>Choose Your Participation Route</h1>
            <p className={s.routeSub}>Santulan is available through two participation routes. Select the option that applies to you.</p>
          </div>
          <p className={s.routeScript} aria-hidden="true">“Different Journeys.<br />A Brighter<br />Tomorrow.”</p>
        </div>

        <div className={s.routeWrap}>
          <div className={s.routeCards}>
            <section className={`${s.routeCard} ${s.routeGreen}`} aria-labelledby="route-open">
              <div className={s.routeCardHead}>
                <IconBadge icon={UserRound} tone="green" size="lg" />
                <div>
                  <p className={s.cardEyebrow}>Open route</p>
                  <h2 id="route-open" className={s.routeH2}>Register as an Individual</h2>
                  <p className={s.routeDesc}>For adolescents and emerging adults who are participating independently.</p>
                </div>
              </div>
              <CheckList items={['Self-registration with email or mobile number', 'Complete your age confirmation and consent', 'Get your Santulan ID and start the assessment']} />
              <ButtonLink to="/register" variant="route-open" size="lg" icon>Register Now</ButtonLink>
            </section>
            <section className={`${s.routeCard} ${s.routeBlue}`} aria-labelledby="route-institution">
              <div className={s.routeCardHead}>
                <IconBadge icon={Landmark} tone="blue" size="lg" />
                <div>
                  <p className={`${s.cardEyebrow} ${s.cardEyebrowBlue}`}>Institution route</p>
                  <h2 id="route-institution" className={s.routeH2}>Join Through Your Institution</h2>
                  <p className={s.routeDesc}>For participants from schools, colleges or organisations invited by their institution.</p>
                </div>
              </div>
              <CheckList tone="blue" items={['Use the Santulan ID your institution gave you', 'Sign in with your temporary password', 'Set a new password and continue']} />
              <ButtonLink to="/login" variant="route-institution" size="lg" icon>Sign in with a Santulan ID</ButtonLink>
            </section>
          </div>

          <div className={s.helpStrip}>
            <div className={s.helpItem}>
              <IconBadge icon={CircleHelp} tone="blue" />
              <div>
                <h2 className={s.helpTitle}>Not sure which route to choose?</h2>
                <p className={s.helpText}>If you have been invited by your school, college or organisation, please use the Institution Route. Otherwise, you can register through the Open Route.</p>
              </div>
            </div>
            <Link to="/support" className={`${s.helpItem} ${s.helpLink}`}>
              <IconBadge icon={Headphones} tone="blue" />
              <div>
                <h2 className={s.helpTitle}>Need Help?</h2>
                <p className={s.helpText}>Visit our Support Centre or contact us for assistance.</p>
              </div>
              <ArrowRight size={22} aria-hidden="true" className={s.helpArrow} />
            </Link>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}

/** Static support page (approved contact and safeguarding text is pending: TODO(copy)). */
export function SupportPage({ embedded = false }) {
  const body = (
    <div className={embedded ? styles.stack : `${s.container} ${s.narrow} ${styles.stack}`}>
      <h1 className={styles.h2}>Support</h1>
      <p className={styles.lead}>If something is worrying you, or you need help using Santulan, please talk to someone you trust, such as a parent, guardian, teacher or coordinator.</p>
      <RailCard tone="help" title="Need help?">
        <p>Approved support and safeguarding contact details will appear here. TODO(copy): contact details are provided by the programme owner.</p>
      </RailCard>
      <RailCard tone="safe" title="Privacy, terms and safeguarding" icon={ShieldCheck}>
        <p>The privacy notice, the terms of use and the safeguarding statement will be published here once the programme owner has approved them. TODO(copy).</p>
      </RailCard>
    </div>
  );
  return embedded ? body : <PublicLayout>{body}</PublicLayout>;
}
