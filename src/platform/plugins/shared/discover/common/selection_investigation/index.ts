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
export const SELECTION_INVESTIGATION_MAX_SCOPE_DEPTH = 4;

export type InvestigationPhase = 'total' | 'planning' | 'contributors' | 'patterns';
export type InvestigationPhaseStatus = 'start' | 'success' | 'failure';
export type InvestigationDirection = 'increased' | 'decreased' | 'new' | 'disappeared';
export type InvestigationDocumentsTimeScope = 'selection' | 'baseline';
export type InvestigationFindingKind = 'volume' | 'contributor' | 'pattern';
export type InvestigationTriagePriority = 'investigate_now' | 'monitor' | 'informational';
export type InvestigationTriageSignal =
  | 'material_change'
  | 'new_activity'
  | 'disappeared_activity'
  | 'large_shift'
  | 'concentrated_shift'
  | 'scoped_change'
  | 'message_pattern'
  | 'multiple_evidence';
export type InvestigationModelTriageSignal = Exclude<InvestigationTriageSignal, 'material_change'>;
export type InvestigationTriageAction = 'show_documents' | 'open_query';
export type InvestigationCoverageIssue =
  | 'selection_empty'
  | 'baseline_empty'
  | 'no_checks_completed';

/**
 * Whether this row can still be broken down, and if not why. `not_applicable` is the overall
 * volume finding, which has nothing above it to narrow.
 */
export type InvestigationDeeperInvestigation =
  | 'available'
  | 'change_too_small'
  | 'max_depth_reached'
  | 'not_applicable';

export interface InvestigationScope {
  field: string;
  value: string | number | boolean | null;
  mode: 'equals' | 'rlike';
}

export interface SelectionInvestigationRequest {
  requestId: string;
  query: string;
  timeField: string;
  selection: { from: string; to: string };
  filters: Filter[];
  variables: Record<string, ESQLControlVariable>;
  scopes?: InvestigationScope[];
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
  field?: string;
  scope?: {
    field: string;
    value: string | number | boolean | null;
  };
}

export interface InvestigationModelOutput {
  candidates: Array<{
    primary: InvestigationEvidenceReference;
    patternTokens: string[];
    triage: {
      priority: InvestigationTriagePriority;
      signals: InvestigationModelTriageSignal[];
      nextAction: InvestigationTriageAction;
    };
  }>;
}

export interface InvestigationPreviewRow {
  key: string;
  selectionCount: number;
  baselineCount: number;
  delta: number;
}

export interface InvestigationFinding {
  id: string;
  kind: InvestigationFindingKind;
  dimension: string;
  value: string;
  patternTokens: string[];
  investigationPath: Array<{
    dimension: string;
    value: string;
  }>;
  direction: InvestigationDirection;
  selectionCount: number;
  baselineCount: number;
  absoluteChange: number;
  relativeChange: number | null;
  candidateShare: number;
  selection: InvestigationTimeRange;
  baseline: InvestigationTimeRange;
  filterCount: number;
  query: string;
  documentsQuery: string;
  documentsTimeScope: InvestigationDocumentsTimeScope;
  preview: InvestigationPreviewRow[];
  triage: InvestigationFindingTriage;
  scopes: InvestigationScope[];
  deeperInvestigation: InvestigationDeeperInvestigation;
}

/**
 * The server decides what to say; every wording is derived on the browser from these codes, so
 * the text follows the reader's locale rather than the Kibana server's.
 */
export interface InvestigationFindingTriage {
  priority: InvestigationTriagePriority;
  signals: InvestigationTriageSignal[];
  nextAction: InvestigationTriageAction;
}

export interface InvestigationTriage extends InvestigationFindingTriage {
  findingId: string;
}

export interface SelectionInvestigationResult {
  outcome:
    | 'changes_found'
    // The volume moved, but none of the fields checked accounts for it.
    | 'unexplained_change'
    | 'no_material_change'
    | 'insufficient_evidence';
  findings: InvestigationFinding[];
  /**
   * Who picked these findings. `server_ranking` means the agent settled on nothing the evidence
   * supported, so the server ranked what its probes had already collected.
   */
  findingsSelectedBy?: 'agent' | 'server_ranking';
  triage?: InvestigationTriage;
  insufficientEvidenceReason?: InvestigationCoverageIssue;
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
