/*
 * Research-safe views (data-model section 8, BUILD 08 section 10). No view ever emits participant_id (the participant's
 * _id), auth_provider*, external_student_id, contact or guardian fields: identity is exposed only as the opaque
 * santulan_id. The views are read-only; the runtime credential reads them without any right on the source collections.
 */
const lookupOne = (from, localField, foreignField, as) => [
  { $lookup: { from, localField, foreignField, as } },
  { $unwind: { path: `$${as}`, preserveNullAndEmptyArrays: true } },
];

const participantOf = (field, as = 'p') => lookupOne('participants', field, '_id', as);

const filterColumns = (p = 'p') => ({
  institution_id: `$${p}.institution_id`,
  cohort_id: `$${p}.cohort_id`,
  participant_status: `$${p}.status`,
});

const views = [
  {
    name: 'v_research_participants',
    source: 'participants',
    pipeline: [
      ...lookupOne('institutions', 'institution_id', '_id', 'inst'),
      ...lookupOne('cohorts', 'cohort_id', '_id', 'coh'),
      {
        $project: {
          _id: 0,
          santulan_id: 1,
          participation_route: 1,
          assessment_track: 1,
          developmental_band: 1,
          institution_id: 1,
          institution_code: '$inst.institution_code',
          cohort_id: 1,
          cohort_code: '$coh.cohort_code',
          education_stage: '$coh.education_stage',
          participant_status: '$status',
          created_at: 1,
        },
      },
    ],
  },
  {
    name: 'v_research_attempts',
    source: 'assessment_attempts',
    pipeline: [
      ...participantOf('participant_id'),
      ...lookupOne('assessment_versions', 'assessment_version_id', '_id', 'v'),
      {
        $project: {
          _id: 0,
          attempt_id: '$_id',
          santulan_id: '$p.santulan_id',
          version_label: '$v.version_label',
          status: 1,
          session_count: 1,
          created_at: 1,
          started_at: 1,
          submitted_at: 1,
          completed_at: 1,
          ...filterColumns(),
        },
      },
    ],
  },
  {
    name: 'v_research_item_responses',
    source: 'responses',
    pipeline: [
      ...lookupOne('assessment_attempts', 'attempt_id', '_id', 'a'),
      ...participantOf('a.participant_id'),
      ...lookupOne('items', 'item_id', '_id', 'i'),
      {
        $project: {
          _id: 0,
          response_id: '$_id',
          attempt_id: 1,
          santulan_id: '$p.santulan_id',
          assessment_version_id: '$i.assessment_version_id',
          item_code: '$i.item_code',
          domain_code: '$i.domain_code',
          subdomain_code: '$i.subdomain_code',
          response_value: 1,
          option_count: { $size: { $ifNull: ['$i.options', []] } },
          response_version: 1,
          is_current: 1,
          response_time_ms: 1,
          presented_order: 1,
          answered_at: 1,
          ...filterColumns(),
        },
      },
    ],
  },
  {
    name: 'v_research_domain_scores',
    source: 'score_results',
    pipeline: [
      ...participantOf('participant_id'),
      {
        $project: {
          _id: 0,
          attempt_id: 1,
          santulan_id: '$p.santulan_id',
          domain_code: 1,
          raw_score: 1,
          eligible_items: 1,
          valid_items: 1,
          completeness_rate: 1,
          completeness_status: 1,
          score_status: 1,
          scoring_version: 1,
          calculated_at: 1,
          ...filterColumns(),
        },
      },
    ],
  },
  {
    name: 'v_research_quality_flags',
    source: 'quality_flags',
    pipeline: [
      { $match: { flag_code: { $in: ['Q01', 'Q02', 'Q03', 'Q04', 'Q05', 'Q06', 'Q07', 'Q08'] } } }, // Q09 never leaves
      ...lookupOne('assessment_attempts', 'attempt_id', '_id', 'a'),
      ...participantOf('a.participant_id'),
      {
        $project: {
          _id: 0,
          attempt_id: 1,
          santulan_id: '$p.santulan_id',
          domain_code: 1,
          flag_code: 1,
          severity: 1,
          detected_at: 1,
          disposition: 1,
          reviewed_at: 1,
          ...filterColumns(),
        },
      },
    ],
  },
  {
    name: 'v_research_response_events',
    source: 'response_events',
    pipeline: [
      ...lookupOne('assessment_attempts', 'attempt_id', '_id', 'a'),
      ...participantOf('a.participant_id'),
      {
        $project: {
          _id: 0,
          event_id: '$_id',
          attempt_id: 1,
          santulan_id: '$p.santulan_id',
          event_type: 1,
          session_number: 1,
          occurred_at: 1,
          metadata: 1,
          ...filterColumns(),
        },
      },
      { $unset: 'metadata.idempotency_key' },
    ],
  },
  {
    name: 'v_research_assessment_versions',
    source: 'assessment_versions',
    pipeline: [
      {
        $project: {
          _id: 0,
          assessment_version_id: '$_id',
          version_label: 1,
          revision: 1,
          configuration: 1,
          content_hash: 1,
          status: 1,
          frozen_at: 1,
        },
      },
    ],
  },
  {
    name: 'v_research_cohorts',
    source: 'cohorts',
    pipeline: [
      ...lookupOne('institutions', 'institution_id', '_id', 'inst'),
      {
        $project: {
          _id: 0,
          institution_id: 1,
          institution_code: '$inst.institution_code',
          institution_type: '$inst.institution_type',
          cohort_id: '$_id',
          cohort_code: 1,
          academic_year: 1,
          education_stage: 1,
          developmental_band: 1,
          status: 1,
        },
      },
    ],
  },
  {
    // Research-only candidate subdomain view (scoring master section 8). NOT participant-facing and NOT granted to the
    // runtime credential. Same position -> value rule as the domain score; held subdomains are flagged.
    name: 'v_candidate_subdomain_scores',
    source: 'responses',
    research_only: true,
    pipeline: [
      { $match: { is_current: true } },
      ...lookupOne('items', 'item_id', '_id', 'i'),
      { $match: { 'i.layer': 'CORE', 'i.status': 'ACTIVE' } },
      {
        $addFields: {
          value: {
            $add: [1, { $multiply: [{ $subtract: [{ $toInt: '$response_value' }, 1] }, { $divide: [4, { $subtract: [{ $size: '$i.options' }, 1] }] }] }],
          },
        },
      },
      {
        $group: {
          _id: { attempt_id: '$attempt_id', subdomain_code: '$i.subdomain_code', assessment_version_id: '$i.assessment_version_id' },
          domain_code: { $first: '$i.domain_code' },
          answered_items: { $sum: 1 },
          candidate_mean: { $avg: '$value' },
        },
      },
      ...lookupOne('assessment_attempts', '_id.attempt_id', '_id', 'a'),
      ...participantOf('a.participant_id'),
      {
        $lookup: {
          from: 'items',
          let: { v: '$_id.assessment_version_id', s: '$_id.subdomain_code' },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ['$assessment_version_id', '$$v'] }, { $eq: ['$subdomain_code', '$$s'] }, { $eq: ['$layer', 'CORE'] }, { $eq: ['$status', 'ACTIVE'] }] } } },
            { $count: 'n' },
          ],
          as: 'elig',
        },
      },
      {
        $project: {
          _id: 0,
          attempt_id: '$_id.attempt_id',
          santulan_id: '$p.santulan_id',
          domain_code: 1,
          subdomain_code: '$_id.subdomain_code',
          eligible_items: { $ifNull: [{ $arrayElemAt: ['$elig.n', 0] }, 0] },
          answered_items: 1,
          candidate_mean: { $round: ['$candidate_mean', 2] },
          interpretation_hold: { $in: ['$_id.subdomain_code', ['C4.2', 'C2.10']] }, // Self-Worth, Savoring
        },
      },
    ],
  },
];

module.exports = { views };
