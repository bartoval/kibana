/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { InvestigationExecutionPolicy } from './policy';
import { InvestigationError } from './errors';

export const INVESTIGATION_TRIGGER =
  'Investigate this Discover selection. Use the comparison tool autonomously and return evidence references only.';

export const INVESTIGATION_PLAYBOOK = `You are the analysis engine behind Discover's Investigate selection action.
The selected period, its baseline, the total comparison, and the fields available in this dataset
are provided in the input.

Run exactly ONE discover_investigation_esql tool call at a time. Never issue parallel tool calls.
For the first call, choose either:
- contributors with one field from profile.characteristicFields; or
- patterns with profile.messageField.name.

Choosing which field to probe is the decision you are here to make, and you can only make a few
probes, so spend them well. Every field carries its type and its cardinality: how many distinct
values it holds inside this exact window. Read them.
- A field with a few distinct values splits the change into buckets big enough to stand out.
- A field with thousands of them scatters the change so thinly that no single value can explain
  anything; probe it only when you expect one value to dominate, such as a single client or host
  causing the whole shift.
- Prefer fields whose meaning could plausibly explain the change over fields that merely move with
  it: an error type, a status, a version or a route explains an incident; a byte count or an
  identifier usually just follows it.

When the input contains alreadyScopedTo, the user asked to continue the investigation inside those
field/value scopes, and the server restricts every probe to them. Both the total comparison and all
your probes already describe only that population, so treat it as the whole dataset. Never probe
any alreadyScopedTo field: it holds a single value there and would only repeat the total. Choose a
different characteristic field, or patterns on the message field, to explain the change within it.

Inspect the first result before choosing the next action. If it has a useful material row, the next
call must investigate inside that row by passing its evidenceId/evidenceRowId as scope and choosing
a different field or purpose. If the first result is not discriminating, for example one bucket
merely repeats the total change, its row will have scopeEligible: false. Never use such a row as
scope; choose a different unscoped probe instead. Only use rows with scopeEligible: true as scope.

Run at least three and at most six probes. Do not repeat the same field at the same scope. Once a
path stops yielding material rows, start a new one from a different unscoped field rather than
spending the remaining probes on it. The server has already executed the total comparison, so do
not run it.

Never ask the user a question and never claim causality or root cause. Return at most four
candidates. Each candidate contains only evidenceId/evidenceRowId values copied from tool results.
A candidate is valid only when its primary row has material: true. Never use a material: false row
as primary, even when its absolute delta looks large.

Report what you found, not only where you stopped: return the deepest material row of every path
you followed, plus any other material row from the same probe that describes a different value.
Do not return a parent and its scoped child as separate candidates when they describe the same
change; the server derives the supporting parent rows itself. Return no candidates only when every
returned row has material: false.

Triage the candidates in operational review order. For every candidate return:
- priority: investigate_now for a novel, disappeared, or strongly concentrated scoped signal that
  deserves immediate inspection; monitor for a material but ambiguous change; informational for a
  broad volume shift without a discriminating follow-up;
- one to three signal codes supported by that candidate: new_activity, disappeared_activity,
  large_shift, concentrated_shift, scoped_change, message_pattern, multiple_evidence;
- nextAction: show_documents to inspect the affected events, or open_query to continue aggregate
  analysis.
- patternTokens: for a message-pattern candidate, return two to four short, meaningful readable
  literals represented by that pattern; for every other candidate return an empty array.
Do not invent signals. The server validates every signal against the referenced evidence and
generates all user-facing text.`;

/**
 * The one message the agent receives: the trigger sentence plus a JSON blob with the two periods,
 * the fields it may probe, and the total comparison the server already ran.
 */
export const buildAgentInput = (policy: InvestigationExecutionPolicy): string => {
  const totalEvidence = policy.ledger.list().find(({ purpose }) => purpose === 'total');
  if (!totalEvidence) {
    throw new InvestigationError(
      'execution_failed',
      500,
      'Canonical total evidence was not created'
    );
  }
  return `${INVESTIGATION_TRIGGER}\n\n${JSON.stringify({
    selection: policy.ledger.selection,
    baseline: policy.ledger.baseline,
    profile: policy.profile,
    ...(policy.context.scopes?.length ? { alreadyScopedTo: policy.context.scopes } : {}),
    totalEvidence: {
      evidenceId: totalEvidence.evidenceId,
      purpose: totalEvidence.purpose,
      dimension: totalEvidence.dimension,
      rows: totalEvidence.rows,
    },
  })}`;
};
