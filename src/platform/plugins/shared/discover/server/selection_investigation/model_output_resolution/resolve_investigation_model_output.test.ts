/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { resolveInvestigationModelOutput } from './resolve_investigation_model_output';

const minimalValidOutput = {
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

describe('resolveInvestigationModelOutput', () => {
  it('resolves handover JSON from message content', () => {
    const result = resolveInvestigationModelOutput({
      strategy: 'agent_builder_handover_json',
      payload: {
        messageContent: JSON.stringify(minimalValidOutput),
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source).toBe('agent_builder_handover_json');
      expect(result.data.answer.status).toBe('inconclusive');
    }
  });

  it('resolves structured output from Agent Builder', () => {
    const result = resolveInvestigationModelOutput({
      strategy: 'agent_builder_structured_output',
      payload: {
        messageContent: '',
        structuredOutput: minimalValidOutput,
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source).toBe('agent_builder_structured_output');
    }
  });

  it('reports schema failures for handover JSON', () => {
    const result = resolveInvestigationModelOutput({
      strategy: 'agent_builder_handover_json',
      payload: {
        messageContent: JSON.stringify({ answer: { status: 'unsupported_status' } }),
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('schema_invalid');
    }
  });
});
