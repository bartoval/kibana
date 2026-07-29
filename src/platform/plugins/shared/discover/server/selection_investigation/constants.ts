/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { InvestigationModelOutputResolutionStrategy } from './model_output_resolution/types';

export const DISCOVER_INVESTIGATION_ESQL_TOOL_ID = 'platform.discover.investigation_esql';

// Each comparison runs the same model-chosen query over selection and baseline; three probes can
// therefore create up to six concurrent ES|QL requests.
export const INVESTIGATION_MAX_COMPARISONS = 5;
export const INVESTIGATION_MAX_CONCURRENT_PROBES = 3;
export const INVESTIGATION_MAX_EXPLORATION_PROBES = 3;
export const INVESTIGATION_MAX_VERIFICATION_PROBES = 2;
// Refusals cost no Elasticsearch query, but a run that only ever gets refused still has to end.
export const INVESTIGATION_MAX_REJECTIONS = 6;
export const INVESTIGATION_QUERY_TIMEOUT_MS = 30_000;
export const INVESTIGATION_RUN_TIMEOUT_MS = 2 * 60_000;

/**
 * How Discover turns an Agent Builder run into {@link InvestigationModelOutput}.
 * - `agent_builder_handover_json`: research handover JSON in `message_content` (option B).
 * - `agent_builder_structured_output`: AB answer agent `structured_output` field.
 * Replace this constant or swap `model_output_resolution/` to change strategy.
 */
export const INVESTIGATION_MODEL_OUTPUT_RESOLUTION: InvestigationModelOutputResolutionStrategy =
  'agent_builder_handover_json';
/** While synthesis is open, log if Agent Builder emits no events for this long. */
export const INVESTIGATION_SYNTHESIS_STALL_LOG_INTERVAL_MS = 30_000;
/** Max characters of message_content included in debug logs. */
export const INVESTIGATION_LOG_MESSAGE_PREVIEW_CHARS = 500;
export const INVESTIGATION_MAX_BODY_BYTES = 256 * 1024;
export const INVESTIGATION_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
// Bounds field names and variable values carried in the request, not ES|QL query semantics.
export const INVESTIGATION_MAX_FIELD_VALUE_LENGTH = 4_096;
export const INVESTIGATION_MAX_VARIABLES = 50;
export const INVESTIGATION_MAX_VALUES_PER_VARIABLE = 100;
export const INVESTIGATION_MAX_ROWS = 10;
export const INVESTIGATION_MAX_FINDINGS = 4;
export const INVESTIGATION_MAX_FOLLOW_UPS = 3;
/** Playbook targets (schema still allows up to max). Fewer handover fields reduce final-turn latency. */
export const INVESTIGATION_PREFERRED_FINDINGS = 3;
export const INVESTIGATION_PREFERRED_FOLLOW_UPS = 2;
export const INVESTIGATION_MAX_PROFILE_FIELDS = 50;
export const INVESTIGATION_MAX_FILTERS = 100;
