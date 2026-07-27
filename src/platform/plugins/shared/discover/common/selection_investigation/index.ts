/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { Filter } from '@kbn/es-query';
import type { ESQLControlVariable } from '@kbn/esql-types';

export const SELECTION_INVESTIGATION_ROUTE = '/internal/discover/selection_investigation' as const;
export const SELECTION_INVESTIGATION_MAX_GOAL_LENGTH = 500;

export type InvestigationPhase = 'planning' | 'query' | 'synthesis';
export type InvestigationPhaseStatus = 'start' | 'success' | 'failure';
export type InvestigationDirection = 'increased' | 'decreased' | 'unchanged';
export type InvestigationFindingKind = 'metric' | 'dimension' | 'pattern';
type InvestigationVariable = Pick<ESQLControlVariable, 'key' | 'value' | 'type'>;

/**
 * A finding selected as the starting lead for a new run. It guides the model but is not evidence;
 * the new investigation must support its answer with results produced in that run.
 */
export interface InvestigationFocus {
  title: string;
  summary: string;
  kind: InvestigationFindingKind;
  dimension: string;
  value: string;
  selectionValue: number;
  baselineValue: number;
  query: string;
}

export interface SelectionInvestigationRequest {
  requestId: string;
  goal: string;
  query: string;
  timeField: string;
  selection: { from: string; to: string };
  filters: Filter[];
  variables: InvestigationVariable[];
  focus?: InvestigationFocus;
}

export interface InvestigationTimeRange {
  from: string;
  to: string;
}

export interface InvestigationEvidenceReference {
  evidenceId: string;
  evidenceRowId: string;
}

export interface InvestigationProgressStep {
  stepId: string;
  phase: InvestigationPhase;
  status: InvestigationPhaseStatus;
  wave?: 'exploration' | 'verification';
  label?: string;
  rationale?: string;
  result?: {
    rowCount: number;
    esqlExecutionMs?: number;
  };
}

export interface InvestigationModelOutput {
  answer: {
    status: InvestigationAnswerStatus;
    title: string;
    summary: string;
    nextStep: string;
    followUps: Array<{
      goal: string;
      reason: string;
      evidence: InvestigationEvidenceReference[];
    }>;
    candidates: Array<{
      primary: InvestigationEvidenceReference;
      kind: InvestigationFindingKind;
      title: string;
      interpretation: string;
      openQuestion: string;
    }>;
  };
}

export interface InvestigationPreviewRow {
  key: string;
  selectionValue: number;
  baselineValue: number;
  delta: number;
}

export interface InvestigationFinding {
  id: string;
  title: string;
  summary: string;
  kind: InvestigationFindingKind;
  dimension: string;
  value: string;
  direction: InvestigationDirection;
  selectionValue: number;
  baselineValue: number;
  absoluteChange: number;
  relativeChange: number | null;
  selection: InvestigationTimeRange;
  baseline: InvestigationTimeRange;
  filterCount: number;
  query: string;
  preview: InvestigationPreviewRow[];
}

export type InvestigationAnswerStatus =
  | 'supported'
  | 'partially_supported'
  | 'no_signal_found'
  | 'inconclusive'
  | 'insufficient_observability';

export interface InvestigationAnswer {
  status: InvestigationAnswerStatus;
  title: string;
  summary: string;
  nextStep: string;
  followUps: InvestigationFollowUp[];
}

export interface InvestigationFollowUp {
  goal: string;
  reason: string;
}

export interface InvestigationRuntimeTimings {
  /** Time until Agent Builder emits the first exploration decision, including execution setup. */
  planningAndSetupMs?: number;
  /** Time between completed exploration probes and the verification decision. */
  verificationDecisionMs?: number;
  /**
   * Time from the final probe result to the structured answer. Agent Builder's public event stream
   * does not expose the research handoff and structured synthesis as separate phases.
   */
  handoffAndSynthesisMs?: number;
  totalAgentMs: number;
  investigativeDecisionCount: number;
}

export interface SelectionInvestigationResult {
  findings: InvestigationFinding[];
  answer: InvestigationAnswer;
  timings?: InvestigationRuntimeTimings;
}

export type SelectionInvestigationSseEvent =
  | {
      type: 'started';
      data: {
        requestId: string;
        selection: InvestigationTimeRange;
        baseline: InvestigationTimeRange;
      };
    }
  | { type: 'phase'; data: InvestigationProgressStep }
  | { type: 'completed'; data: SelectionInvestigationResult }
  | { type: 'aborted'; data: { reason: 'client' | 'timeout' | 'protocol' } }
  | { type: 'investigation_error'; data: { code: string; message?: string } };
