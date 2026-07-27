/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type {
  InvestigationPhaseStatus,
  InvestigationProgressStep,
  SelectionInvestigationRequest,
} from '../../common/selection_investigation';
import { INVESTIGATION_MAX_ATTEMPTS, INVESTIGATION_MAX_REJECTIONS } from './constants';
import { InvestigationError } from './errors';
import type { EvidenceLedger } from './evidence';
import type { CoverageProfile } from './profile';

interface InvestigationExecutionPolicyParams {
  runId: string;
  context: SelectionInvestigationRequest;
  profile: CoverageProfile;
  ledger: EvidenceLedger;
  signal: AbortSignal;
  onPhase: (
    step: Omit<InvestigationProgressStep, 'status'>,
    status: InvestigationPhaseStatus
  ) => void;
}

/**
 * Everything one investigation is allowed to do and see. The agent never receives this; it only
 * picks a probe, and the server reads the policy to decide whether that probe may run.
 */
export class InvestigationExecutionPolicy {
  public readonly runId: string;
  public readonly context: SelectionInvestigationRequest;
  public readonly profile: CoverageProfile;
  public readonly ledger: EvidenceLedger;
  public readonly signal: AbortSignal;
  public readonly onPhase: InvestigationExecutionPolicyParams['onPhase'];
  private attemptCount = 0;
  private rejectionCount = 0;

  constructor(params: InvestigationExecutionPolicyParams) {
    this.runId = params.runId;
    this.context = params.context;
    this.profile = params.profile;
    this.ledger = params.ledger;
    this.signal = params.signal;
    this.onPhase = params.onPhase;
  }

  // Caps how many Elasticsearch queries one investigation can make, whoever asked for them.
  public reserveAttempt(): number {
    this.attemptCount += 1;
    if (this.attemptCount > INVESTIGATION_MAX_ATTEMPTS) {
      throw new InvestigationError(
        'protocol_violation',
        400,
        `The investigation query budget of ${INVESTIGATION_MAX_ATTEMPTS} attempts was exceeded`
      );
    }
    return this.attemptCount;
  }

  // A refused probe never reached Elasticsearch, so it owes nothing to the query budget. It is
  // still counted, because a run that only ever gets refused has to stop rather than keep asking.
  public recordRejection(): void {
    this.rejectionCount += 1;
    if (this.rejectionCount > INVESTIGATION_MAX_REJECTIONS) {
      throw new InvestigationError(
        'protocol_violation',
        400,
        `The investigation refused ${INVESTIGATION_MAX_REJECTIONS} probes and cannot continue`
      );
    }
  }

  public get attempts(): number {
    return this.attemptCount;
  }
}

// Live investigations, keyed by execution id. The tool handler looks itself up here: if there is
// no entry, the tool was called outside an investigation and must refuse.
const policies = new Map<string, InvestigationExecutionPolicy>();

export const registerInvestigationPolicy = (
  executionId: string,
  policy: InvestigationExecutionPolicy
): (() => void) => {
  policies.set(executionId, policy);
  return () => {
    policies.delete(executionId);
  };
};

export const getInvestigationPolicy = (executionId: string) => policies.get(executionId);
