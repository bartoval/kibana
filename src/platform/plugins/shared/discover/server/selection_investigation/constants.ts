/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

export const DISCOVER_INVESTIGATION_ESQL_TOOL_ID = 'platform.discover.investigation_esql';

// Budgets and limits. Every investigation runs inside all of them at once.
// The agent picks from INVESTIGATION_MAX_PROFILE_FIELDS candidates and the server spends the first
// attempt on the total, so this has to leave room to explore a wide profile, not just confirm a
// lucky first guess.
export const INVESTIGATION_MAX_ATTEMPTS = 12;
// Refusals cost no Elasticsearch query, but a run that only ever gets refused still has to end.
export const INVESTIGATION_MAX_REJECTIONS = 12;
export const INVESTIGATION_QUERY_TIMEOUT_MS = 30_000;
export const INVESTIGATION_RUN_TIMEOUT_MS = 4 * 60_000;
export const INVESTIGATION_MAX_BODY_BYTES = 256 * 1024;
export const INVESTIGATION_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const INVESTIGATION_MAX_CONTEXT_STRING_CHARS = 4_096;
export const INVESTIGATION_MAX_VALUES_PER_VARIABLE = 100;
export const INVESTIGATION_MAX_ROWS = 10;
export const INVESTIGATION_MAX_FINDINGS = 4;
// The agent picks a handful of fields out of this many. Kept generous on purpose: choosing well
// only has value when enumerating everything would be expensive, and each field costs nothing
// until it is actually probed.
export const INVESTIGATION_MAX_PROFILE_FIELDS = 50;
export const INVESTIGATION_MIN_FIELD_CARDINALITY = 2;
export const INVESTIGATION_MAX_QUERY_LENGTH = 16 * 1024;
export const INVESTIGATION_MAX_COMPOSED_QUERY_LENGTH = 24 * 1024;
export const INVESTIGATION_MAX_FILTERS = 100;

// A row must clear all of these to count as a real change rather than noise.
export const INVESTIGATION_MATERIAL_MIN_ABSOLUTE_CHANGE = 5;
export const INVESTIGATION_MATERIAL_MIN_CHANGE_SHARE = 0.1;
export const INVESTIGATION_MATERIAL_MIN_RELATIVE_CHANGE = 0.5;
export const INVESTIGATION_MATERIAL_MIN_POISSON_CHANGE = 3;

// Drilling down partitions a row: for a part to clear the materiality floor and still leave a
// remainder, the whole has to be worth at least two floors. Below that the aggregate comparison
// has nothing left to say and the documents themselves are the answer.
export const INVESTIGATION_MIN_DRILLDOWN_ABSOLUTE_CHANGE =
  2 * INVESTIGATION_MATERIAL_MIN_ABSOLUTE_CHANGE;

// Higher bars, used only to decide which triage signals a finding may claim. The normalized change
// is a z-score, so this is the conventional "not a fluctuation" bar, set above the 3 that merely
// clears the noise floor: at the floor itself nearly every finding qualifies and the signal stops
// telling two findings apart. Measured on the normalized change alone, because that is what "large
// relative to the observed volume" means — a raw count cannot say it.
export const INVESTIGATION_TRIAGE_LARGE_MIN_POISSON_CHANGE = 5;
export const INVESTIGATION_TRIAGE_CONCENTRATED_MIN_CHANGE_SHARE = 0.5;

// The Discover query may only contain commands that keep one document per row, so that the
// investigation can still count documents per period after it runs.
export const BASE_QUERY_ALLOWED_COMMANDS = new Set([
  'from',
  'where',
  'eval',
  'keep',
  'drop',
  'rename',
  'dissect',
  'grok',
]);
