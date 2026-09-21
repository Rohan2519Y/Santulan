/* Research exports, audit log and the dev-only credential store (BUILD 01 section 6.26, 6.28; CR-006-7). */
const E = require('../enums');
const D = require('../dsl');

const { uuid, str, bool, date, obj, collection, isNull, notNull, implies, eq } = D;

const researchExports = collection('research_exports', 'B', {
  requested_by: uuid(),
  filters: obj(),
  anonymisation_version: str({ nonblank: true }),
  source_assessment_version_id: uuid(),
  created_at: date(),
  status: str({ enum: E.EXPORT_STATUS }),
  file_reference: str({ nullable: true }),
  completed_at: date({ nullable: true }),
}, [
  implies(eq('$status', 'READY'), notNull('$file_reference')),
  implies(eq('$status', 'FAILED'), isNull('$file_reference')),
]);

const auditLogs = collection('audit_logs', 'A', {
  actor_type: str({ enum: E.ACTOR_TYPE }),
  actor_id: uuid({ nullable: true }),
  action_type: str({ nonblank: true }),
  target_entity: str({ nonblank: true }),
  target_id: uuid({ nullable: true }),
  previous_state: obj({ nullable: true }),
  new_state: obj({ nullable: true }),
  reason: str({ nullable: true }),
  occurred_at: date(),
  correlation_id: str({ nullable: true }),
});

// Non-canonical, development only (the managed identity provider replaces it in production).
const devIdentityCredentials = collection('dev_identity_credentials', 'B', {
  provider: str({ nonblank: true }),
  subject_id: str({ nonblank: true }),
  secret_hash: str({ nonblank: true }),
  must_change: bool(),
  status: str({ enum: E.DEV_STATUS }),
  created_at: date(),
  updated_at: date(),
});

module.exports = [researchExports, auditLogs, devIdentityCredentials];
