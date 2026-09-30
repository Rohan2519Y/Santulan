/*
 * "Santulan Pilot Study Details" PART A rules (docs/Santulan 2.0/Profile, the older superseded draft).
 *
 * IMPORTANT - this is a deliberate override, not a spec reading: the currently-APPROVED profile form
 * (Santulan_Pilot_Student_Demographic_and_Research_Profile_Capture_Form_v1_0) explicitly lists full_name,
 * date_of_birth and religion (among others) under "Fields to EXCLUDE from the basic demographic form", and its
 * "Current pilot identity rule" says in writing: "Do not add DOB, full name, phone, email, Aadhaar or exact address
 * to the canonical assessment profile unless a separately approved operational/legal change requires it." This
 * collection exists only because that exclusion was explicitly overridden by direction during this build, after the
 * conflict was surfaced and confirmed - it is not something either source document calls for.
 *
 * Everything below is otherwise unstructured in both source PDFs: neither document gives a fixed option list for
 * "Class" or "Gender" (unlike the approved form's education_stage/gender_research, which DO have option lists), so
 * those two stay free text here rather than an invented enum.
 */
const CAPTURE_VERSION = 'PILOT_STUDY_DETAILS_v1.0';

/** Builds the document from the validated request body. Every optional field defaults to null (the collection
 * validator requires every field to be present, even when unanswered). */
function buildPilotDetails({ _id, participantId, body }) {
  return {
    _id,
    participant_id: participantId,
    capture_version: CAPTURE_VERSION,
    full_name: body.fullName.trim(),
    date_of_birth: body.dateOfBirth ? new Date(body.dateOfBirth) : null,
    class_name: body.className ?? null,
    gender: body.gender ?? null,
    birth_order: body.birthOrder ?? null,
    sibling_count: body.siblingCount ?? null,
    religion: body.religion ?? null,
    family_type: body.familyType ?? null,
    residence_type: body.residenceType ?? null,
    state: body.state ?? null,
    school_type: body.schoolType ?? null,
    study_medium: body.studyMedium ?? null,
    board: body.board ?? null,
    academic_stream: body.academicStream ?? null,
    created_at: new Date(),
  };
}

module.exports = { CAPTURE_VERSION, buildPilotDetails };
