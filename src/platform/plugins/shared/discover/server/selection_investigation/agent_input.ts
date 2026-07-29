/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */
import type { InvestigationModelOutputResolutionStrategy } from './model_output_resolution';
import type { InvestigationExecutionPolicy } from './policy';
import {
  INVESTIGATION_MAX_EXPLORATION_PROBES,
  INVESTIGATION_MAX_VERIFICATION_PROBES,
  INVESTIGATION_MODEL_OUTPUT_RESOLUTION,
  INVESTIGATION_PREFERRED_FINDINGS,
  INVESTIGATION_PREFERRED_FOLLOW_UPS,
} from './constants';

const INVESTIGATION_TRIGGER =
  'Investigate the user mission inside the frozen Discover scope and return structured, evidence-linked output.';

const INVESTIGATION_PLAYBOOK_SHARED = `You are the analysis engine behind a Discover investigation.
The user supplies a mission and Discover supplies an immutable ES|QL query, filters, selection,
and equal-length previous period. Decide what to investigate and how to interpret the results.
Never ask the user a question or modify data.

Return the requested structured answer with candidates inside the answer object. Prefer three
strong candidates (never more than four) in review order. Each candidate cites one comparable
evidence row from this run and uses a specific title. Its interpretation explains why the result
matters to the mission in one or two concise sentences; its openQuestion is one short sentence on
what remains unproven. Neither field repeats the counts displayed by Discover or merely calls the
change substantial.
Prefer two follow-ups (never more than three). Each cites completed evidence and proposes a concrete
investigation Discover can perform.

The answer directly addresses the mission:
- supported: the cited checks answer it;
- partially_supported: a strong relevant signal was found but an important explanation remains;
- no_signal_found: the goal-specific checks found no matching signal;
- inconclusive: completed results conflict or cannot support an interpretation;
- insufficient_observability: the available query output cannot assess the mission.

Use natural product language. Explain what changed, what it may mean, and what remains unknown.
Keep the answer summary to two or three complete sentences and each follow-up reason to one.
Do not mention the agent, policies, evidence roles, field suffixes, or implementation details. Do
not claim causality from association. The server owns displayed numbers; use its results without
inventing or recalculating values. A focused previous finding is context, not evidence for this run.
Treat a one-value breakdown that merely repeats the total as a discarded check: do not select it as
a candidate, use it to support a follow-up, or recommend checking the same field again.
Make nextStep concrete and executable in the current Discover scope, never generic advice.`;

const INVESTIGATION_PLAYBOOK_STRUCTURED_HANDOFF = `When research is complete, hand off a compact conclusion with evidence IDs rather than drafting the
final product response.`;

const INVESTIGATION_PLAYBOOK_HANDOVER_JSON_INSTRUCTIONS = `Probe budget: at most ${INVESTIGATION_MAX_EXPLORATION_PROBES} parallel exploration calls, then at most ${INVESTIGATION_MAX_VERIFICATION_PROBES} parallel verification calls. Do not exceed these limits or repeat signatures.

When research is complete, stop calling tools. Your final message must be ONLY one JSON object—no markdown, no bullet lists, and no prose before or after the JSON—with this shape:
{ "answer": { "status", "title", "summary", "nextStep", "candidates", "followUps" } }.
Use status one of: supported, partially_supported, no_signal_found, inconclusive, insufficient_observability.
Include ${INVESTIGATION_PREFERRED_FINDINGS} candidates when possible (hard cap four) and ${INVESTIGATION_PREFERRED_FOLLOW_UPS} followUps when possible (hard cap three). Each candidate needs primary.evidenceId,
primary.evidenceRowId, kind (metric|dimension|pattern), title, interpretation, openQuestion.
Each followUp needs goal, reason, and evidence[] with evidenceId and evidenceRowId from this run only.
Stay well under length limits: title max 120 chars, summary max 800 (aim ~400), nextStep max 300, candidate title max 100,
interpretation max 350 (aim ~200), openQuestion max 250 (aim ~120), followUp reason max 300 (aim ~150).`;

/** Playbook used when AB runs the structured answer agent (legacy path). */
export const INVESTIGATION_PLAYBOOK_AGENT_BUILDER_STRUCTURED = `${INVESTIGATION_PLAYBOOK_SHARED}
${INVESTIGATION_PLAYBOOK_STRUCTURED_HANDOFF}`;

/** Playbook used when the research agent emits final JSON in the handover (option B). */
export const INVESTIGATION_PLAYBOOK_HANDOVER_JSON = `${INVESTIGATION_PLAYBOOK_SHARED}
${INVESTIGATION_PLAYBOOK_HANDOVER_JSON_INSTRUCTIONS}`;

/** @deprecated Use {@link getInvestigationPlaybookForResolution} */
export const INVESTIGATION_PLAYBOOK = INVESTIGATION_PLAYBOOK_AGENT_BUILDER_STRUCTURED;

export const getInvestigationPlaybookForResolution = (
  strategy: InvestigationModelOutputResolutionStrategy = INVESTIGATION_MODEL_OUTPUT_RESOLUTION
): string =>
  strategy === 'agent_builder_handover_json'
    ? INVESTIGATION_PLAYBOOK_HANDOVER_JSON
    : INVESTIGATION_PLAYBOOK_AGENT_BUILDER_STRUCTURED;

export const buildAgentInput = (policy: InvestigationExecutionPolicy): string =>
  `${INVESTIGATION_TRIGGER}\n\n${JSON.stringify({
    mission: policy.context.goal,
    discoverQuery: policy.context.query,
    timeField: policy.context.timeField,
    selection: policy.ledger.selection,
    baseline: policy.ledger.baseline,
    availableColumns: policy.profile,
    focus: policy.context.focus,
  })}`;
