/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { normalizeHandoverModelOutput } from './normalize_handover_model_output';
import { resolveFromAgentBuilderHandoverJson } from './resolve_from_handover_json';

describe('normalizeHandoverModelOutput', () => {
  it('truncates follow-up reasons that exceed schema limits', () => {
    const longReason = 'r'.repeat(400);
    const normalized = normalizeHandoverModelOutput({
      answer: {
        status: 'partially_supported',
        title: 'Title',
        summary: 'Summary',
        nextStep: 'Next',
        candidates: [
          {
            primary: { evidenceId: 'ev_1', evidenceRowId: 'er_1' },
            kind: 'metric',
            title: 'Candidate',
            interpretation: 'Interpretation',
            openQuestion: 'Question',
          },
        ],
        followUps: [
          {
            goal: 'Goal',
            reason: longReason,
            evidence: [{ evidenceId: 'ev_1', evidenceRowId: 'er_1' }],
          },
        ],
      },
    }) as { answer: { followUps: Array<{ reason: string }> } };

    expect(normalized.answer.followUps[0].reason).toHaveLength(300);
  });
});

describe('resolveFromAgentBuilderHandoverJson with prose prefix', () => {
  it('parses JSON appended after markdown notes', () => {
    const payload = {
      answer: {
        status: 'inconclusive',
        title: 'Title',
        summary: 'Summary',
        nextStep: 'Next',
        followUps: [
          {
            goal: 'Goal',
            reason: 'Reason',
            evidence: [{ evidenceId: 'ev_1', evidenceRowId: 'er_1' }],
          },
        ],
        candidates: [
          {
            primary: { evidenceId: 'ev_1', evidenceRowId: 'er_1' },
            kind: 'metric',
            title: 'Candidate',
            interpretation: 'Interpretation',
            openQuestion: 'Question',
          },
        ],
      },
    };
    const message = `Notes before handover\n\n${JSON.stringify(payload)}`;
    const result = resolveFromAgentBuilderHandoverJson(message);
    expect(result.ok).toBe(true);
  });
});
