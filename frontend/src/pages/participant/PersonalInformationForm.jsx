import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import styles from '../../styles/ui.module.css';
import p from '../../styles/portal.module.css';
import Field from '../../components/Field/Field';
import Button from '../../components/Button/Button';
import Skeleton from '../../components/Skeleton/Skeleton';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import { InfoNote } from '../../components/participantKit';
import { api } from '../../services/santulanApi';

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
const GENDER_RESEARCH = [['FEMALE', 'Female / girl / woman'], ['MALE', 'Male / boy / man'], ['NON_BINARY_OTHER', 'Non-binary / another gender'], ['SELF_DESCRIBE', 'Self-describe'], ['PREFER_NOT_TO_SAY', 'Prefer not to say']];
const REGION_MODE = [['STATE_UT', 'State / UT'], ['BROADER', 'Broad region only'], ['PREFER_NOT_TO_SAY', 'Prefer not to say']];
const URBANICITY = [['URBAN', 'Urban'], ['SEMI_URBAN', 'Semi-urban'], ['RURAL', 'Rural'], ['OTHER', 'Other / unsure'], ['PREFER_NOT_TO_SAY', 'Prefer not to say']];
const ACCESSIBILITY = [
  ['NONE', 'None'], ['LARGE_TEXT', 'Larger text / display adjustment'], ['READER', 'Reader / assisted reading'],
  ['EXTRA_TIME', 'Extra time / breaks'], ['TRANSLATION', 'Translated or language support'], ['OTHER', 'Other'], ['PREFER_NOT_TO_SAY', 'Prefer not to say'],
];
const BIRTH_ORDER = [['ONLY_CHILD', 'Only child'], ['FIRST_BORN', 'First-born'], ['MIDDLE_BORN', 'Middle-born'], ['YOUNGEST', 'Youngest'], ['OTHER', 'Other']];
const RELIGION = [['HINDU', 'Hindu'], ['MUSLIM', 'Muslim'], ['CHRISTIAN', 'Christian'], ['SIKH', 'Sikh'], ['BUDDHIST', 'Buddhist'], ['JAIN', 'Jain'], ['OTHER', 'Other'], ['PREFER_NOT_TO_SAY', 'Prefer not to say']];
const FAMILY_TYPE = [['NUCLEAR', 'Nuclear'], ['JOINT', 'Joint'], ['EXTENDED', 'Extended'], ['OTHER', 'Other']];
const RESIDENCE_TYPE = [['URBAN', 'Urban'], ['SEMI_URBAN', 'Semi-urban'], ['RURAL', 'Rural']];
const SCHOOL_TYPE = [['GOVERNMENT', 'Government'], ['PRIVATE', 'Private'], ['GOVERNMENT_AIDED', 'Government-aided'], ['OTHER', 'Other']];
const STUDY_MEDIUM = [['HINDI', 'Hindi'], ['ENGLISH', 'English'], ['OTHER', 'Other']];
const BOARD = [['CBSE', 'CBSE'], ['ICSE', 'ICSE'], ['STATE_BOARD', 'State Board'], ['OTHER', 'Other']];
const ACADEMIC_STREAM = [['SCIENCE', 'Science'], ['COMMERCE', 'Commerce'], ['HUMANITIES_ARTS', 'Humanities / Arts'], ['OTHER', 'Other'], ['NOT_APPLICABLE', 'Not applicable']];

const Select = ({ label, value, onChange, options, hint, required = false }) => (
  <Field as="select" label={label} value={value} onChange={(e) => onChange(e.target.value)} hint={hint} required={required}>
    <option value="">Choose...</option>
    {options.map(([code, text]) => <option key={code} value={code}>{text}</option>)}
  </Field>
);

const BLANK = {
  fullName: '', dateOfBirth: '', className: '', gender: '',
  educationStage: '', currentClassYear: '', primaryLanguageMode: '', primaryLanguageDetail: '',
  mediumOfInstruction: '', mediumOfInstructionDetail: '', genderResearch: '', genderSelfDescription: '',
  broadRegionMode: '', broadRegionDetail: '', urbanicity: '', accessibilityAccommodation: '', accessibilityAccommodationDetail: '',
  birthOrder: '', siblingCount: '', religion: '', familyType: '', residenceType: '', state: '',
  schoolType: '', studyMedium: '', board: '', academicStream: '',
};

export function hasRequiredIdentification(details) {
  return Boolean(details && details.fullName && details.dateOfBirth && details.className && details.gender);
}

function fromStored(profile, details) {
  const form = { ...BLANK };
  for (const key of Object.keys(form)) {
    const source = Object.prototype.hasOwnProperty.call(details || {}, key) ? details : profile;
    if (source && source[key] != null) form[key] = key === 'siblingCount' ? String(source[key]) : source[key];
  }
  if (form.dateOfBirth) form.dateOfBirth = String(form.dateOfBirth).slice(0, 10);
  return form;
}

function profilePayload(form) {
  const body = {};
  const copy = (key) => { if (form[key]) body[key] = form[key]; };
  copy('educationStage'); copy('currentClassYear'); copy('primaryLanguageMode'); copy('mediumOfInstruction');
  copy('genderResearch'); copy('broadRegionMode'); copy('urbanicity'); copy('accessibilityAccommodation');
  if (['DIFFERENT', 'MULTILINGUAL'].includes(form.primaryLanguageMode)) body.primaryLanguageDetail = form.primaryLanguageDetail.trim();
  if (form.mediumOfInstruction === 'OTHER') body.mediumOfInstructionDetail = form.mediumOfInstructionDetail.trim();
  if (form.genderResearch === 'SELF_DESCRIBE') body.genderSelfDescription = form.genderSelfDescription.trim();
  if (['STATE_UT', 'BROADER'].includes(form.broadRegionMode)) body.broadRegionDetail = form.broadRegionDetail.trim();
  if (form.accessibilityAccommodation === 'OTHER') body.accessibilityAccommodationDetail = form.accessibilityAccommodationDetail.trim();
  return body;
}

function detailsPayload(form) {
  const body = {
    fullName: form.fullName.trim(),
    dateOfBirth: form.dateOfBirth,
    className: form.className.trim(),
    gender: form.gender.trim(),
  };
  const text = ['state'];
  const selected = ['birthOrder', 'religion', 'familyType', 'residenceType', 'schoolType', 'studyMedium', 'board', 'academicStream'];
  text.forEach((key) => { if (form[key].trim()) body[key] = form[key].trim(); });
  selected.forEach((key) => { if (form[key]) body[key] = form[key]; });
  if (form.siblingCount !== '') body.siblingCount = Number(form.siblingCount);
  return body;
}

function validate(form) {
  if (!form.fullName.trim() || !form.dateOfBirth || !form.className.trim() || !form.gender.trim()) {
    return 'Full name, date of birth, class, and gender are required.';
  }
  if (['DIFFERENT', 'MULTILINGUAL'].includes(form.primaryLanguageMode) && !form.primaryLanguageDetail.trim()) return 'Please enter the primary or home language.';
  if (form.mediumOfInstruction === 'OTHER' && !form.mediumOfInstructionDetail.trim()) return 'Please enter the medium of instruction.';
  if (form.genderResearch === 'SELF_DESCRIBE' && !form.genderSelfDescription.trim()) return 'Please enter the gender description.';
  if (['STATE_UT', 'BROADER'].includes(form.broadRegionMode) && !form.broadRegionDetail.trim()) return 'Please enter the selected region.';
  if (form.accessibilityAccommodation === 'OTHER' && !form.accessibilityAccommodationDetail.trim()) return 'Please describe the accessibility support.';
  return '';
}

export default function PersonalInformationForm({ registration, onSaved }) {
  const [form, setForm] = useState(BLANK);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.ownProfile().catch((e) => (e.status === 404 ? null : Promise.reject(e))),
      api.ownPilotDetails().catch((e) => (e.status === 404 ? null : Promise.reject(e))),
    ]).then(([profile, details]) => {
      if (!cancelled) setForm(fromStored(profile, details));
    }).catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const set = (key) => (value) => setForm((current) => ({
    ...current,
    [key]: value,
    ...(key === 'educationStage' ? { currentClassYear: '' } : {}),
  }));

  const submit = async (event) => {
    event.preventDefault();
    const validationError = validate(form);
    if (validationError) { setError(validationError); setSaved(false); return; }
    setBusy(true); setError(''); setSaved(false);
    try {
      await api.submitProfile(profilePayload(form));
      await api.submitPilotDetails(detailsPayload(form));
      setSaved(true);
      window.dispatchEvent(new Event('santulan:profile-updated'));
      if (onSaved) onSaved();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  if (!loaded) return <div aria-busy="true" className={styles.stack}><Skeleton /><Skeleton /></div>;

  const isOpen = registration.participationRoute === 'OPEN';
  const classYearOptions = CLASS_YEAR_BY_STAGE[form.educationStage] || [];

  return (
    <form className={styles.stack} onSubmit={submit}>
      {isOpen ? (
        <InfoNote icon={Info}>Complete the required identification fields before continuing to your dashboard.</InfoNote>
      ) : (
        <InfoNote icon={Info}>Your institution provides your identification information through its roster. Review the information here and contact your coordinator if it is incorrect.</InfoNote>
      )}
      {error && <StatusMessage type="error" message={error} />}
      {saved && !error && <StatusMessage type="success" message="Your personal information has been saved." />}

      <section className={p.panel}>
        <h2 className={p.panelTitle}>Identification</h2>
        <p className={styles.muted} style={{ margin: '0 0 var(--sp-5)' }}>All four fields are required.</p>
        <div className={styles.grid2}>
          <Field label="Full name" value={form.fullName} onChange={(e) => set('fullName')(e.target.value)} required maxLength={200} />
          <Field label="Date of birth" type="date" value={form.dateOfBirth} onChange={(e) => set('dateOfBirth')(e.target.value)} required />
          <Field label="Class" value={form.className} onChange={(e) => set('className')(e.target.value)} required maxLength={120} />
          <Field label="Gender" value={form.gender} onChange={(e) => set('gender')(e.target.value)} required maxLength={120} />
        </div>
      </section>

      <section className={p.panel}>
        <h2 className={p.panelTitle}>Studies</h2>
        <div className={styles.grid2}>
          <Select label="Current education stage" value={form.educationStage} onChange={set('educationStage')} options={EDUCATION_STAGE} />
          {classYearOptions.length > 0 && <Select label="Current class / year" value={form.currentClassYear} onChange={set('currentClassYear')} options={classYearOptions} />}
          <Select label="Type of school" value={form.schoolType} onChange={set('schoolType')} options={SCHOOL_TYPE} />
          <Select label="Study medium" value={form.studyMedium} onChange={set('studyMedium')} options={STUDY_MEDIUM} />
          <Select label="Board" value={form.board} onChange={set('board')} options={BOARD} />
          <Select label="Academic stream (Class 11-12 only)" value={form.academicStream} onChange={set('academicStream')} options={ACADEMIC_STREAM} />
        </div>
      </section>

      <section className={p.panel}>
        <h2 className={p.panelTitle}>Language</h2>
        <div className={styles.grid2}>
          <Select label="Primary / home language" value={form.primaryLanguageMode} onChange={set('primaryLanguageMode')} options={LANGUAGE_MODE} />
          {['DIFFERENT', 'MULTILINGUAL'].includes(form.primaryLanguageMode) && <Field label="Which language(s)?" value={form.primaryLanguageDetail} onChange={(e) => set('primaryLanguageDetail')(e.target.value)} maxLength={120} />}
          <Select label="Medium of instruction" value={form.mediumOfInstruction} onChange={set('mediumOfInstruction')} options={MEDIUM_OF_INSTRUCTION} />
          {form.mediumOfInstruction === 'OTHER' && <Field label="Which language?" value={form.mediumOfInstructionDetail} onChange={(e) => set('mediumOfInstructionDetail')(e.target.value)} maxLength={120} />}
        </div>
      </section>

      <section className={p.panel}>
        <h2 className={p.panelTitle}>Family and background</h2>
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
        <h2 className={p.panelTitle}>Additional information</h2>
        <div className={styles.grid2}>
          <Select label="Gender for research (optional)" value={form.genderResearch} onChange={set('genderResearch')} options={GENDER_RESEARCH} />
          {form.genderResearch === 'SELF_DESCRIBE' && <Field label="Self-describe" value={form.genderSelfDescription} onChange={(e) => set('genderSelfDescription')(e.target.value)} maxLength={120} />}
          {isOpen && <Select label="Broad region (optional)" value={form.broadRegionMode} onChange={set('broadRegionMode')} options={REGION_MODE} hint="Do not enter an exact home address." />}
          {isOpen && ['STATE_UT', 'BROADER'].includes(form.broadRegionMode) && <Field label="Which region?" value={form.broadRegionDetail} onChange={(e) => set('broadRegionDetail')(e.target.value)} maxLength={120} />}
          {isOpen && <Select label="Area (optional)" value={form.urbanicity} onChange={set('urbanicity')} options={URBANICITY} />}
          <Select label="Accessibility support used (optional)" value={form.accessibilityAccommodation} onChange={set('accessibilityAccommodation')} options={ACCESSIBILITY} />
          {form.accessibilityAccommodation === 'OTHER' && <Field label="Please describe" value={form.accessibilityAccommodationDetail} onChange={(e) => set('accessibilityAccommodationDetail')(e.target.value)} maxLength={120} />}
        </div>
      </section>

      <InfoNote icon={Info} tone="quiet">This information is used for participation and research. It does not change your assessment results.</InfoNote>
      <div className={styles.row}>
        <Button type="submit" size="lg" disabled={busy}>{busy ? 'Saving...' : 'Save personal information'}</Button>
      </div>
    </form>
  );
}
