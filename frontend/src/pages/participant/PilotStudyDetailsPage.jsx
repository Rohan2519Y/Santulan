/*
 * "Santulan Pilot Study Details" PART A capture - an explicit override of the approved profile form's own "exclude
 * full name/DOB/religion" list (see backend participantPilotDetailsRules.js for the full override note; this page
 * exists only because that exclusion was deliberately overridden, not because either source document calls for it).
 * Reachable from the profile tabs (My profile > Pilot study details). fullName is the only required question; every
 * other field is optional and may be left blank. Each save is a new row (Tier A, insert-only) - the backend always
 * reads back the latest one, so editing never loses the audit trail of earlier answers.
 */
import { useEffect, useState } from 'react';
import styles from '../../styles/ui.module.css';
import p from '../../styles/portal.module.css';
import Field from '../../components/Field/Field';
import Button from '../../components/Button/Button';
import Skeleton from '../../components/Skeleton/Skeleton';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import { InfoNote } from '../../components/participantKit';
import { Info } from 'lucide-react';
import { api } from '../../services/santulanApi';
import { ProfileTabs } from './AccountPages';

const BIRTH_ORDER = [['ONLY_CHILD', 'Only child'], ['FIRST_BORN', 'First-born'], ['MIDDLE_BORN', 'Middle-born'], ['YOUNGEST', 'Youngest'], ['OTHER', 'Other']];
const RELIGION = [['HINDU', 'Hindu'], ['MUSLIM', 'Muslim'], ['CHRISTIAN', 'Christian'], ['SIKH', 'Sikh'], ['BUDDHIST', 'Buddhist'], ['JAIN', 'Jain'], ['OTHER', 'Other'], ['PREFER_NOT_TO_SAY', 'Prefer not to say']];
const FAMILY_TYPE = [['NUCLEAR', 'Nuclear'], ['JOINT', 'Joint'], ['EXTENDED', 'Extended'], ['OTHER', 'Other']];
const RESIDENCE_TYPE = [['URBAN', 'Urban'], ['SEMI_URBAN', 'Semi-urban'], ['RURAL', 'Rural']];
const SCHOOL_TYPE = [['GOVERNMENT', 'Government'], ['PRIVATE', 'Private'], ['GOVERNMENT_AIDED', 'Government-aided'], ['OTHER', 'Other']];
const STUDY_MEDIUM = [['HINDI', 'Hindi'], ['ENGLISH', 'English'], ['OTHER', 'Other']];
const BOARD = [['CBSE', 'CBSE'], ['ICSE', 'ICSE'], ['STATE_BOARD', 'State Board'], ['OTHER', 'Other']];
const ACADEMIC_STREAM = [['SCIENCE', 'Science'], ['COMMERCE', 'Commerce'], ['HUMANITIES_ARTS', 'Humanities / Arts'], ['OTHER', 'Other'], ['NOT_APPLICABLE', 'Not applicable']];

const Select = ({ label, value, onChange, options }) => (
  <Field as="select" label={label} value={value} onChange={(e) => onChange(e.target.value)}>
    <option value="">Choose…</option>
    {options.map(([code, text]) => <option key={code} value={code}>{text}</option>)}
  </Field>
);

const BLANK = {
  fullName: '', dateOfBirth: '', className: '', gender: '', birthOrder: '', siblingCount: '', religion: '',
  familyType: '', residenceType: '', state: '', schoolType: '', studyMedium: '', board: '', academicStream: '',
};

/** Only fullName (required) plus every question actually answered is sent. */
function toPayload(form) {
  const body = { fullName: form.fullName.trim() };
  if (form.dateOfBirth) body.dateOfBirth = form.dateOfBirth;
  if (form.className.trim()) body.className = form.className.trim();
  if (form.gender.trim()) body.gender = form.gender.trim();
  if (form.birthOrder) body.birthOrder = form.birthOrder;
  if (form.siblingCount !== '') body.siblingCount = Number(form.siblingCount);
  if (form.religion) body.religion = form.religion;
  if (form.familyType) body.familyType = form.familyType;
  if (form.residenceType) body.residenceType = form.residenceType;
  if (form.state.trim()) body.state = form.state.trim();
  if (form.schoolType) body.schoolType = form.schoolType;
  if (form.studyMedium) body.studyMedium = form.studyMedium;
  if (form.board) body.board = form.board;
  if (form.academicStream) body.academicStream = form.academicStream;
  return body;
}

/** The reverse of toPayload: an existing submission (from GET /participants/pilot-details) becomes form state. */
function fromDetails(d) {
  const form = { ...BLANK };
  for (const key of Object.keys(BLANK)) {
    if (d[key] == null) continue;
    form[key] = key === 'siblingCount' ? String(d[key]) : d[key];
  }
  return form;
}

export default function PilotStudyDetailsPage() {
  const [form, setForm] = useState(BLANK);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.ownPilotDetails().then((d) => { if (!cancelled) setForm(fromDetails(d)); })
      .catch((e) => { if (!cancelled && e.status !== 404) setError(e.message); })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(''); setSaved(false);
    try { await api.submitPilotDetails(toPayload(form)); setSaved(true); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  if (!loaded) return <div aria-busy="true" className={styles.stack}><Skeleton /><Skeleton /></div>;

  return (
    <div className={p.page}>
      <ProfileTabs current="/student/pilot-study-details" />
      <div>
        <h1 className={p.pageTitle}>Pilot study details</h1>
        <p className={p.pageLead}>A few additional details for this pilot round. Only your full name is required - everything else is optional and can be left blank.</p>
      </div>
      {error && <StatusMessage type="error" message={error} />}
      {saved && !error && <StatusMessage type="success" message="Saved." />}
      <form className={styles.stack} onSubmit={submit}>
        <section className={p.panel}>
          <h2 className={p.panelTitle}>Identification</h2>
          <div className={styles.grid2}>
            <Field label="Full name" value={form.fullName} onChange={(e) => set('fullName')(e.target.value)} required maxLength={200} />
            <Field label="Date of birth" type="date" value={form.dateOfBirth} onChange={(e) => set('dateOfBirth')(e.target.value)} />
            <Field label="Class" value={form.className} onChange={(e) => set('className')(e.target.value)} maxLength={120} />
            <Field label="Gender" value={form.gender} onChange={(e) => set('gender')(e.target.value)} maxLength={120} />
          </div>
        </section>

        <section className={p.panel}>
          <h2 className={p.panelTitle}>Family &amp; background</h2>
          <div className={styles.grid2}>
            <Select label="Birth order" value={form.birthOrder} onChange={set('birthOrder')} options={BIRTH_ORDER} />
            <Field label="Number of siblings" type="number" min={0} max={50} value={form.siblingCount} onChange={(e) => set('siblingCount')(e.target.value)} />
            <Select label="Religion" value={form.religion} onChange={set('religion')} options={RELIGION} />
            <Select label="Type of family" value={form.familyType} onChange={set('familyType')} options={FAMILY_TYPE} />
            <Select label="Place of residence" value={form.residenceType} onChange={set('residenceType')} options={RESIDENCE_TYPE} />
            <Field label="State" value={form.state} onChange={(e) => set('state')(e.target.value)} maxLength={120} />
          </div>
        </section>

        <section className={p.panel}>
          <h2 className={p.panelTitle}>Education</h2>
          <div className={styles.grid2}>
            <Select label="Type of school" value={form.schoolType} onChange={set('schoolType')} options={SCHOOL_TYPE} />
            <Select label="Medium of instruction" value={form.studyMedium} onChange={set('studyMedium')} options={STUDY_MEDIUM} />
            <Select label="Board" value={form.board} onChange={set('board')} options={BOARD} />
            <Select label="Academic stream (Class 11-12 only)" value={form.academicStream} onChange={set('academicStream')} options={ACADEMIC_STREAM} />
          </div>
        </section>

        <InfoNote icon={Info} tone="quiet">These details are used only for this pilot round. They never change your assessment results.</InfoNote>

        <div className={styles.row}>
          <Button type="submit" size="lg" disabled={busy || !form.fullName.trim()}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </div>
  );
}
