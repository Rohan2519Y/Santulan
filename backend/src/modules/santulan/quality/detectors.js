/*
 * Behavioural / protocol quality detectors (BUILD 06 §9-§10). Q06 is deterministic and lives in the database
 * (build06_detect_q06); Q09 is a human safeguarding workflow (q09Trigger.js). Every other detector is an INERT STUB:
 * the sources define the concept but not a validated cutoff or protocol, so none is invented here.
 *
 *   Q01 straightlining   Q02 speeding   Q03 long latency   Q04 rapid switching   (thresholds not frozen)
 *   Q05 duplicate participation (protocol not frozen)      Q07 missingness cluster (threshold not frozen)
 *   Q08 context / access (signal source and rule not frozen; must never lower a score mechanically)
 *
 * A stub returns no flag. If an approved policy ENABLES a stub, the quality run fails closed (DETECTOR_NOT_IMPLEMENTED)
 * instead of silently reporting CLEAR - an attempt is never cleared by a detector that did not really run.
 */
const STUBS = ['Q01', 'Q02', 'Q03', 'Q04', 'Q05', 'Q07', 'Q08'];

/** Returns [{ domainCode, severity }]; every stub is inert and returns nothing. */
const inert = async () => [];
const DETECTORS = Object.fromEntries(STUBS.map((code) => [code, { implemented: false, run: inert }]));

module.exports = { DETECTORS, STUBS };
