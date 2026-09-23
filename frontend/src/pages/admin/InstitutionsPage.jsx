import { useState } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../../components/PageHeader/PageHeader';
import Panel from '../../components/Panel/Panel';
import Button from '../../components/Button/Button';
import StatusPill from '../../components/StatusPill/StatusPill';
import StatusMessage from '../../components/StatusMessage/StatusMessage';
import EmptyState from '../../components/EmptyState/EmptyState';
import Skeleton from '../../components/Skeleton/Skeleton';
import Modal from '../../components/Modal/Modal';
import ConfirmDialog from '../../components/ConfirmDialog/ConfirmDialog';
import { useToast } from '../../components/Toast/Toast';
import { adminApi } from '../../services/santulanApi';
import useAdminData from './useAdminData';
import styles from './adminPages.module.css';

const TYPES = [['SCHOOL', 'School'], ['COLLEGE', 'College'], ['UNIVERSITY', 'University']];
const BANDS = ['D1', 'D2', 'D3', 'D4'];
const TONE = { ACTIVE: 'success', INACTIVE: 'neutral', ARCHIVED: 'neutral' };
const EMPTY = { institutionCode: '', institutionName: '', institutionType: 'SCHOOL', parentInstitutionId: '' };
const EMPTY_COHORT = { cohortCode: '', cohortName: '', academicYear: '', developmentalBand: '', educationStage: '' };

/** Institutions and their cohorts as a tree: create and edit in dialogs; archive instead of delete (an archived record never comes back). */
export default function InstitutionsPage() {
  const toast = useToast();
  const data = useAdminData(() => adminApi.institutions(), []);
  const [dialog, setDialog] = useState(null); // { kind: 'institution'|'cohort', mode: 'create'|'edit', target?, institutionId? }
  const [form, setForm] = useState(EMPTY);
  const [archive, setArchive] = useState(null); // { kind, target }
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState(null);

  const open = (next, values) => { setProblem(null); setForm(values); setDialog(next); };
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setWorking(true);
    setProblem(null);
    try {
      if (dialog.kind === 'institution' && dialog.mode === 'create') {
        await adminApi.createInstitution({ institutionCode: form.institutionCode.trim(), institutionName: form.institutionName.trim(), institutionType: form.institutionType, ...(form.parentInstitutionId ? { parentInstitutionId: form.parentInstitutionId } : {}) });
      } else if (dialog.kind === 'institution') {
        await adminApi.updateInstitution(dialog.target.institutionId, { institutionName: form.institutionName.trim(), institutionType: form.institutionType, parentInstitutionId: form.parentInstitutionId || null });
      } else if (dialog.mode === 'create') {
        await adminApi.createCohort({
          institutionId: dialog.institutionId, cohortCode: form.cohortCode.trim(), cohortName: form.cohortName.trim(),
          ...(form.academicYear ? { academicYear: form.academicYear.trim() } : {}), ...(form.developmentalBand ? { developmentalBand: form.developmentalBand } : {}), ...(form.educationStage ? { educationStage: form.educationStage.trim() } : {}),
        });
      } else {
        await adminApi.updateCohort(dialog.target.cohortId, { cohortName: form.cohortName.trim(), academicYear: form.academicYear.trim() || null, developmentalBand: form.developmentalBand || null, educationStage: form.educationStage.trim() || null });
      }
      toast.push({ type: 'success', message: 'Saved. The change is recorded in the audit log.' });
      setDialog(null);
      await data.reload();
    } catch (err) { setProblem(err.message); } finally { setWorking(false); }
  };

  const confirmArchive = async () => {
    setWorking(true);
    setProblem(null);
    try {
      if (archive.kind === 'institution') await adminApi.updateInstitution(archive.target.institutionId, { status: 'ARCHIVED' });
      else await adminApi.updateCohort(archive.target.cohortId, { status: 'ARCHIVED' });
      toast.push({ type: 'success', message: 'Archived. Nothing was deleted.' });
      setArchive(null);
      await data.reload();
    } catch (err) { setProblem(err.message); } finally { setWorking(false); }
  };

  const institutions = data.data ? data.data.institutions : [];
  const children = (parentId) => institutions.filter((i) => (i.parentInstitutionId || null) === parentId);

  const renderInstitution = (i) => (
    <li key={i.institutionId} className={styles.treeItem}>
      <div className={styles.itemHead}>
        <span>{i.institutionName}</span>
        <span className={styles.mono}>{i.institutionCode}</span>
        <StatusPill tone={TONE[i.status]} label={i.status.charAt(0) + i.status.slice(1).toLowerCase()} />
        <span className={styles.rowActions}>
          <Button type="button" variant="secondary" onClick={() => open({ kind: 'institution', mode: 'edit', target: i }, { ...EMPTY, institutionName: i.institutionName, institutionType: i.institutionType, parentInstitutionId: i.parentInstitutionId || '' })} aria-label={`Edit ${i.institutionName}`}>Edit</Button>
          {i.status === 'ACTIVE' && <Button type="button" variant="secondary" onClick={() => open({ kind: 'cohort', mode: 'create', institutionId: i.institutionId }, EMPTY_COHORT)} aria-label={`Add a cohort to ${i.institutionName}`}>Add cohort</Button>}
          {i.status !== 'ARCHIVED' && <Button type="button" variant="secondary" onClick={() => { setProblem(null); setArchive({ kind: 'institution', target: i }); }} aria-label={`Archive ${i.institutionName}`}>Archive</Button>}
        </span>
      </div>
      {i.cohorts.length > 0 && (
        <ul className={styles.tree}>
          {i.cohorts.map((c) => (
            <li key={c.cohortId} className={styles.cohortRow}>
              <span className={styles.cohortTag}>Cohort</span>
              <span className={styles.cohortName}>{c.cohortName}</span>
              <span className={styles.mono}>{c.cohortCode}</span>
              <StatusPill tone={TONE[c.status]} label={c.status.charAt(0) + c.status.slice(1).toLowerCase()} />
              <span className={styles.rowActions}>
                <Button type="button" variant="secondary" onClick={() => open({ kind: 'cohort', mode: 'edit', target: c }, { ...EMPTY_COHORT, cohortName: c.cohortName, academicYear: c.academicYear || '', developmentalBand: c.developmentalBand || '', educationStage: c.educationStage || '' })} aria-label={`Edit cohort ${c.cohortName}`}>Edit</Button>
                {c.status !== 'ARCHIVED' && <Button type="button" variant="secondary" onClick={() => { setProblem(null); setArchive({ kind: 'cohort', target: c }); }} aria-label={`Archive cohort ${c.cohortName}`}>Archive</Button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {children(i.institutionId).length > 0 && <ul className={`${styles.tree} ${styles.treeSub}`}>{children(i.institutionId).map(renderInstitution)}</ul>}
    </li>
  );

  const roots = institutions.filter((i) => !i.parentInstitutionId || !institutions.some((p) => p.institutionId === i.parentInstitutionId));
  const title = dialog ? `${dialog.mode === 'create' ? 'Add' : 'Edit'} ${dialog.kind}` : '';

  return (
    <>
      <PageHeader
        title="Institutions"
        description="Schools, colleges and universities with their cohorts. Records are archived, never deleted."
        actions={(
          <>
            <Link to="/admin/roster-import" className={styles.linkButton}>Import a roster</Link>
            <Button type="button" variant="primary" onClick={() => open({ kind: 'institution', mode: 'create' }, EMPTY)}>Add institution</Button>
          </>
        )}
      />
      {data.status === 'loading' && <div aria-busy="true"><Skeleton height={160} /></div>}
      {data.status === 'error' && <StatusMessage type="error" message={data.error} />}
      {data.status === 'ready' && (
        <Panel title="Institutions and cohorts">
          {institutions.length === 0 ? <EmptyState message="No institutions yet. Add one to register institutional participants." /> : <ul className={styles.treeRoot}>{roots.map(renderInstitution)}</ul>}
        </Panel>
      )}

      <Modal open={!!dialog} onClose={() => setDialog(null)} title={title}>
        {dialog && (
          <form className={styles.dialogForm} onSubmit={save}>
            {dialog.kind === 'institution' ? (
              <>
                {dialog.mode === 'create' && <label className={styles.filterField}>Code<input value={form.institutionCode} onChange={set('institutionCode')} required minLength={2} maxLength={40} /></label>}
                <label className={styles.filterField}>Name<input value={form.institutionName} onChange={set('institutionName')} required minLength={2} maxLength={200} /></label>
                <label className={styles.filterField}>Type
                  <select value={form.institutionType} onChange={set('institutionType')}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                </label>
                <label className={styles.filterField}>Parent institution (optional)
                  <select value={form.parentInstitutionId} onChange={set('parentInstitutionId')}>
                    <option value="">None</option>
                    {institutions.filter((p) => !dialog.target || p.institutionId !== dialog.target.institutionId).map((p) => <option key={p.institutionId} value={p.institutionId}>{p.institutionName}</option>)}
                  </select>
                </label>
              </>
            ) : (
              <>
                {dialog.mode === 'create' && <label className={styles.filterField}>Code<input value={form.cohortCode} onChange={set('cohortCode')} required minLength={2} maxLength={40} /></label>}
                <label className={styles.filterField}>Name<input value={form.cohortName} onChange={set('cohortName')} required minLength={2} maxLength={200} /></label>
                <label className={styles.filterField}>Academic year (optional)<input value={form.academicYear} onChange={set('academicYear')} maxLength={20} /></label>
                <label className={styles.filterField}>Band (optional)
                  <select value={form.developmentalBand} onChange={set('developmentalBand')}><option value="">None</option>{BANDS.map((b) => <option key={b} value={b}>{b}</option>)}</select>
                </label>
                <label className={styles.filterField}>Education stage (optional)<input value={form.educationStage} onChange={set('educationStage')} maxLength={60} /></label>
              </>
            )}
            {problem && <StatusMessage type="error" message={problem} />}
            <div className={styles.rowActions}>
              <Button type="button" variant="secondary" onClick={() => setDialog(null)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={working}>{working ? 'Working…' : 'Save'}</Button>
            </div>
          </form>
        )}
      </Modal>

      {archive && (
        <ConfirmDialog
          open
          title={`Archive ${archive.kind === 'institution' ? archive.target.institutionName : archive.target.cohortName}?`}
          message="It is kept with all its data but can no longer be used for new registrations. An archived record cannot be reopened."
          confirmLabel="Archive"
          tone="warning"
          busy={working}
          onConfirm={confirmArchive}
          onCancel={() => setArchive(null)}
        >
          {problem && <StatusMessage type="error" message={problem} />}
        </ConfirmDialog>
      )}
    </>
  );
}
