/*
 * The validation-profile step (Student Demographic & Research Profile Capture Form v1.0, "full recommended set").
 * First shown right after registration (RegisterPage's "Go to Dashboard" sends here first) and before the dashboard;
 * reachable again any time afterwards from the profile tabs (My profile > Research profile) to review or change
 * answers. Every question is optional: "Skip for now"/"Save with nothing filled in" (first visit) and a bare "Save
 * changes" with fields cleared (a later edit) are both valid. Broad region and urbanicity only appear for OPEN
 * participation (the form's own question 11-12 scoping) - an institutional participant's institution/cohort already
 * carries that context. Each save is a new profile row (Tier A, insert-only) - the backend always reads back the
 * latest one, so editing never loses the audit trail of earlier answers.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Info } from 'lucide-react';
import styles from '../../styles/ui.module.css';
import p from '../../styles/portal.module.css';
import Field from '../../components/Field/Field';
import Button from '../../components/Button/Button';
import Skeleton from '../../components/Skeleton/Skeleton';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import { InfoNote } from '../../components/participantKit';
import { api } from '../../services/santulanApi';
import { ProfileTabs } from './AccountPages';

const EDUCATION_STAGE = [
  ['SCHOOL', 'School'], ['DIPLOMA_VOCATIONAL', 'Diploma / Polytechnic / ITI / Vocational programme'],
  ['UNDERGRADUATE', "Undergraduate / Bachelor's programme"], ['POSTGRADUATE', 'Postgraduate programme'],
  ['NOT_ENROLLED', 'Not currently enrolled in formal education'], ['OTHER', 'Other'],
];
const CLASS_YEAR_BY_STAGE = {
  SCHOOL: [['GRADE_7_OR_BELOW', 'Grade 7 or below'], ['GRADE_8', 'Grade 8'], ['GRADE_9', 'Grade 9'], ['GRADE_10', 'Grade 10'], ['GRADE_11', 'Grade 11'], ['GRADE_12', 'Grade 12']],
  DIPLOMA_VOCATIONAL: [['YEAR_1', 'Year 1'], ['YEAR_2', 'Year 2'], ['YEAR_3', 'Year 3'], ['YEAR_4', 'Year 4'], ['OTHER', 'Other']],
  UNDERGRADUATE: [['UG_YEAR_1', 'Year 1'], ['UG_YEAR_2', 'Year 2'], ['UG_YEAR_3', 'Year 3'], ['UG_YEAR_4', 'Year 4'], ['UG_YEAR_5', 'Year 5'], ['OTHER', 'Other']],
  POSTGRADUATE: [['PG_YEAR_1', 'Year 1'], ['PG_YEAR_2', 'Year 2'], ['OTHER', 'Other']],
  NOT_ENROLLED: [['NOT_APPLICABLE', 'Not applicable']],
  OTHER: [['OTHER', 'Other']],
};
const LANGUAGE_MODE = [['SAME_AS_ASSESSMENT', 'Same as assessment language'], ['DIFFERENT', 'A different language'], ['MULTILINGUAL', 'More than one / multilingual'], ['PREFER_NOT_TO_SAY', 'Prefer not to say']];
const MEDIUM_OF_INSTRUCTION = [['ENGLISH', 'English'], ['HINDI', 'Hindi'], ['OTHER', 'Other'], ['MIXED', 'Mixed / bilingual'], ['NOT_APPLICABLE', 'Not applicable'], ['PREFER_NOT_TO_SAY', 'Prefer not to say']];
const GENDER = [['FEMALE', 'Female / girl / woman'], ['MALE', 'Male / boy / man'], ['NON_BINARY_OTHER', 'Non-binary / another gender'], ['SELF_DESCRIBE', 'Self-describe'], ['PREFER_NOT_TO_SAY', 'Prefer not to say']];
const REGION_MODE = [['STATE_UT', 'State / UT'], ['BROADER', 'Broad region only'], ['PREFER_NOT_TO_SAY', 'Prefer not to say']];
const URBANICITY = [['URBAN', 'Urban'], ['SEMI_URBAN', 'Semi-urban'], ['RURAL', 'Rural'], ['OTHER', 'Other / unsure'], ['PREFER_NOT_TO_SAY', 'Prefer not to say']];
const ACCESSIBILITY = [
  ['NONE', 'None'], ['LARGE_TEXT', 'Larger text / display adjustment'], ['READER', 'Reader / assisted reading'],
  ['EXTRA_TIME', 'Extra time / breaks'], ['TRANSLATION', 'Translated or language support'], ['OTHER', 'Other'], ['PREFER_NOT_TO_SAY', 'Prefer not to say'],
];

const Select = ({ label, value, onChange, options, hint }) => (
  <Field as="select" label={label} value={value} onChange={(e) => onChange(e.target.value)} hint={hint}>
    <option value="">Choose…</option>
    {options.map(([code, text]) => <option key={code} value={code}>{text}</option>)}
  </Field>
);

const BLANK = {
  educationStage: '', currentClassYear: '',
  primaryLanguageMode: '', primaryLanguageDetail: '',
  mediumOfInstruction: '', mediumOfInstructionDetail: '',
  genderResearch: '', genderSelfDescription: '',
  broadRegionMode: '', broadRegionDetail: '',
  urbanicity: '', accessibilityAccommodation: '', accessibilityAccommodationDetail: '',
};

/** Only the questions the participant actually answered are sent; the *_detail companions ride along only when their
 * mode demands text (matches the collection validator's own requirement, so a submission never 400s on that). */
function toPayload(form) {
  const body = {};
  if (form.educationStage) body.educationStage = form.educationStage;
  if (form.currentClassYear) body.currentClassYear = form.currentClassYear;
  if (form.primaryLanguageMode) {
    body.primaryLanguageMode = form.primaryLanguageMode;
    if (['DIFFERENT', 'MULTILINGUAL'].includes(form.primaryLanguageMode) && form.primaryLanguageDetail.trim()) body.primaryLanguageDetail = form.primaryLanguageDetail.trim();
  }
  if (form.mediumOfInstruction) {
    body.mediumOfInstruction = form.mediumOfInstruction;
    if (form.mediumOfInstruction === 'OTHER' && form.mediumOfInstructionDetail.trim()) body.mediumOfInstructionDetail = form.mediumOfInstructionDetail.trim();
  }
  if (form.genderResearch) {
    body.genderResearch = form.genderResearch;
    if (form.genderResearch === 'SELF_DESCRIBE' && form.genderSelfDescription.trim()) body.genderSelfDescription = form.genderSelfDescription.trim();
  }
  if (form.broadRegionMode) {
    body.broadRegionMode = form.broadRegionMode;
    if (['STATE_UT', 'BROADER'].includes(form.broadRegionMode) && form.broadRegionDetail.trim()) body.broadRegionDetail = form.broadRegionDetail.trim();
  }
  if (form.urbanicity) body.urbanicity = form.urbanicity;
  if (form.accessibilityAccommodation) {
    body.accessibilityAccommodation = form.accessibilityAccommodation;
    if (form.accessibilityAccommodation === 'OTHER' && form.accessibilityAccommodationDetail.trim()) body.accessibilityAccommodationDetail = form.accessibilityAccommodationDetail.trim();
  }
  return body;
}

/** The reverse of toPayload: an existing profile (from GET /participants/profile) becomes form state, nulls become
 * empty strings (a select's "Choose…" option). */
function fromProfile(profile) {
  const form = { ...BLANK };
  for (const key of Object.keys(BLANK)) if (profile[key] != null) form[key] = profile[key];
  return form;
}

export default function ValidationProfilePage() {
  const navigate = useNavigate();
  const [reg, setReg] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [editing, setEditing] = useState(false); // a profile already existed when this page loaded
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.registrationState(),
      api.ownProfile().catch((e) => (e.status === 404 ? null : Promise.reject(e))),
    ]).then(([r, profile]) => {
      if (cancelled) return;
      setReg(r);
      if (profile) { setForm(fromProfile(profile)); setEditing(true); }
    }).catch((e) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, []);

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value, ...(key === 'educationStage' ? { currentClassYear: '' } : {}) }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await api.submitProfile(toPayload(form)); navigate(editing ? '/student/profile' : '/student', { replace: true }); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const skip = () => navigate(editing ? '/student/profile' : '/student', { replace: true });

  if (error && !reg) return <StatusMessage type="error" message={error} />;
  if (!reg) return <div aria-busy="true" className={styles.stack}><Skeleton /><Skeleton /></div>;

  const classYearOptions = CLASS_YEAR_BY_STAGE[form.educationStage] || [];

  return (
    <div className={p.page}>
      {editing && <ProfileTabs current="/student/validation-profile" />}
      <div>
        <h1 className={p.pageTitle}>{editing ? 'Your research profile' : 'A few questions about you'}</h1>
        <p className={p.pageLead}>
          {editing
            ? 'Review or change your answers any time. Every question is optional - choose "Prefer not to say" wherever it appears, or leave a question blank. None of this affects your results.'
            : 'This helps us understand who takes part and keep the assessment fair for everyone. Every question is optional - choose "Prefer not to say" wherever it appears, or leave a question blank. None of this affects your results.'}
        </p>
      </div>
      {error && <StatusMessage type="error" message={error} />}
      <form className={styles.stack} onSubmit={submit}>
        <section className={p.panel}>
          <h2 className={p.panelTitle}>Your studies</h2>
          <div className={styles.grid2}>
            <Select label="Current education stage" value={form.educationStage} onChange={set('educationStage')} options={EDUCATION_STAGE} />
            {classYearOptions.length > 0 && <Select label="Current class / year" value={form.currentClassYear} onChange={set('currentClassYear')} options={classYearOptions} />}
          </div>
        </section>

        <section className={p.panel}>
          <h2 className={p.panelTitle}>Language</h2>
          <div className={styles.grid2}>
            <Select label="Primary / home language" value={form.primaryLanguageMode} onChange={set('primaryLanguageMode')} options={LANGUAGE_MODE} hint="The language you use most often at home." />
            {['DIFFERENT', 'MULTILINGUAL'].includes(form.primaryLanguageMode) && (
              <Field label="Which language(s)?" value={form.primaryLanguageDetail} onChange={(e) => set('primaryLanguageDetail')(e.target.value)} maxLength={120} />
            )}
            <Select label="Medium of instruction" value={form.mediumOfInstruction} onChange={set('mediumOfInstruction')} options={MEDIUM_OF_INSTRUCTION} hint="Main language used for teaching in your school/college/programme." />
            {form.mediumOfInstruction === 'OTHER' && (
              <Field label="Which language?" value={form.mediumOfInstructionDetail} onChange={(e) => set('mediumOfInstructionDetail')(e.target.value)} maxLength={120} />
            )}
          </div>
        </section>

        <section className={p.panel}>
          <h2 className={p.panelTitle}>A few more questions</h2>
          <div className={styles.grid2}>
            <Select label="Gender (optional)" value={form.genderResearch} onChange={set('genderResearch')} options={GENDER} />
            {form.genderResearch === 'SELF_DESCRIBE' && (
              <Field label="Self-describe" value={form.genderSelfDescription} onChange={(e) => set('genderSelfDescription')(e.target.value)} maxLength={120} />
            )}
            {reg.participationRoute === 'OPEN' && (
              <>
                <Select label="Broad region (optional)" value={form.broadRegionMode} onChange={set('broadRegionMode')} options={REGION_MODE} hint="Avoid your exact home address." />
                {['STATE_UT', 'BROADER'].includes(form.broadRegionMode) && (
                  <Field label="Which region?" value={form.broadRegionDetail} onChange={(e) => set('broadRegionDetail')(e.target.value)} maxLength={120} />
                )}
                <Select label="Area (optional)" value={form.urbanicity} onChange={set('urbanicity')} options={URBANICITY} />
              </>
            )}
            <Select label="Accessibility support used (optional)" value={form.accessibilityAccommodation} onChange={set('accessibilityAccommodation')} options={ACCESSIBILITY} hint="Select only if relevant to how the assessment was administered." />
            {form.accessibilityAccommodation === 'OTHER' && (
              <Field label="Please describe" value={form.accessibilityAccommodationDetail} onChange={(e) => set('accessibilityAccommodationDetail')(e.target.value)} maxLength={120} />
            )}
          </div>
        </section>

        <InfoNote icon={Info} tone="quiet">Your answers are used only for research on how fair and clear the assessment is. They never change your results.</InfoNote>

        <div className={styles.row}>
          <Button type="submit" size="lg" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Save and continue'}</Button>
          <Button type="button" variant="secondary" size="lg" onClick={skip} disabled={busy}>{editing ? 'Cancel' : 'Skip for now'}</Button>
        </div>
      </form>
    </div>
  );
}
