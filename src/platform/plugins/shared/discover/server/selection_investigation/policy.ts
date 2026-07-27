/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { KibanaRequest } from '@kbn/core/server';
import {
  HookExecutionMode,
  HookLifecycle,
  type AgentBuilderPluginSetup,
} from '@kbn/agent-builder-server';
import type {
  InvestigationPhaseStatus,
  InvestigationProgressStep,
  SelectionInvestigationRequest,
} from '../../common/selection_investigation';
import {
  DISCOVER_INVESTIGATION_ESQL_TOOL_ID,
  INVESTIGATION_MAX_COMPARISONS,
  INVESTIGATION_MAX_CONCURRENT_PROBES,
  INVESTIGATION_MAX_EXPLORATION_PROBES,
  INVESTIGATION_MAX_REJECTIONS,
  INVESTIGATION_MAX_VERIFICATION_PROBES,
} from './constants';
import { InvestigationError } from './errors';
import type { EvidenceLedger } from './evidence';
import type { InvestigationSchemaProfile } from './profile';

export type InvestigationProbeWave = 'exploration' | 'verification';

interface InvestigationExecutionPolicyParams {
  runId: string;
  context: SelectionInvestigationRequest;
  profile: InvestigationSchemaProfile;
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
  public readonly profile: InvestigationSchemaProfile;
  public readonly ledger: EvidenceLedger;
  public readonly signal: AbortSignal;
  public readonly onPhase: InvestigationExecutionPolicyParams['onPhase'];
  private comparisonCount = 0;
  private rejectionCount = 0;
  private activeProbeCount = 0;
  private activeWave?: InvestigationProbeWave;
  private readonly closedWaves = new Set<InvestigationProbeWave>();
  private readonly probeCountByWave: Record<InvestigationProbeWave, number> = {
    exploration: 0,
    verification: 0,
  };
  private readonly probeSignatures = new Set<string>();

  constructor(params: InvestigationExecutionPolicyParams) {
    this.runId = params.runId;
    this.context = params.context;
    this.profile = params.profile;
    this.ledger = params.ledger;
    this.signal = params.signal;
    this.onPhase = params.onPhase;
  }

  // Each slot represents one selection/baseline comparison, executed as two ES|QL requests.
  public reserveComparison(): number {
    if (this.comparisonCount >= INVESTIGATION_MAX_COMPARISONS) {
      throw new InvestigationError(
        'protocol_violation',
        400,
        `The investigation budget of ${INVESTIGATION_MAX_COMPARISONS} comparisons was exceeded`
      );
    }
    this.comparisonCount += 1;
    return this.comparisonCount;
  }

  // A refused probe never reached Elasticsearch, so it owes nothing to the comparison budget. It is
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

  public remainingComparisonsAfterWave(wave: InvestigationProbeWave): number {
    if (wave === 'verification') {
      return 0;
    }
    return Math.min(
      INVESTIGATION_MAX_COMPARISONS - this.comparisonCount,
      INVESTIGATION_MAX_VERIFICATION_PROBES
    );
  }

  /**
   * Opens one slot in a model-selected probe wave. Calls emitted in one model turn enter before any
   * Elasticsearch promise settles; when the last slot exits, that wave closes permanently. This
   * preserves two decision cycles while still allowing the calls inside each cycle to run in
   * parallel.
   */
  private assertProbeMayBegin({
    wave,
    signature,
  }: {
    wave: InvestigationProbeWave;
    signature: string;
  }): void {
    const maxForWave =
      wave === 'exploration'
        ? INVESTIGATION_MAX_EXPLORATION_PROBES
        : INVESTIGATION_MAX_VERIFICATION_PROBES;
    if (
      this.closedWaves.has(wave) ||
      (wave === 'exploration' && this.closedWaves.has('verification')) ||
      (wave === 'verification' && !this.closedWaves.has('exploration'))
    ) {
      throw new InvestigationError('query_rejected', 400, `The ${wave} probe wave is not open`);
    }
    if (this.activeWave && this.activeWave !== wave) {
      throw new InvestigationError('query_rejected', 400, 'Probe waves cannot overlap');
    }
    if (
      this.activeProbeCount >= INVESTIGATION_MAX_CONCURRENT_PROBES ||
      this.probeCountByWave[wave] >= maxForWave
    ) {
      throw new InvestigationError('query_rejected', 400, `The ${wave} probe wave is full`);
    }
    if (this.probeSignatures.has(signature)) {
      throw new InvestigationError(
        'query_rejected',
        400,
        'This investigation probe has already been attempted'
      );
    }
  }

  public beginProbe({
    wave,
    signature,
  }: {
    wave: InvestigationProbeWave;
    signature: string;
  }): () => void {
    this.assertProbeMayBegin({ wave, signature });

    this.probeSignatures.add(signature);
    this.probeCountByWave[wave] += 1;
    this.activeProbeCount += 1;
    this.activeWave = wave;
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.activeProbeCount -= 1;
      // A synchronous refusal in one handler must not close the wave before the remaining calls
      // from the same parallel tool-call group have entered.
      queueMicrotask(() => {
        if (this.activeProbeCount === 0 && this.activeWave === wave) {
          this.closedWaves.add(wave);
          this.activeWave = undefined;
        }
      });
    };
  }
}

// Local execution keeps the route, hook, and tool on the same request object. No entry means the
// tool was called outside an active Discover investigation and must refuse.
const policies = new WeakMap<KibanaRequest, InvestigationExecutionPolicy>();

export const registerInvestigationPolicy = (
  request: KibanaRequest,
  policy: InvestigationExecutionPolicy
): (() => void) => {
  policies.set(request, policy);
  return () => {
    policies.delete(request);
  };
};

export const getInvestigationPolicy = (request: KibanaRequest) => policies.get(request);

export const registerInvestigationHooks = (agentBuilder: AgentBuilderPluginSetup): void => {
  agentBuilder.hooks.register({
    id: 'discover-selection-investigation',
    hooks: {
      [HookLifecycle.beforeToolCall]: {
        mode: HookExecutionMode.blocking,
        handler: ({ request, toolId }) => {
          const policy = getInvestigationPolicy(request);
          if (policy && toolId !== DISCOVER_INVESTIGATION_ESQL_TOOL_ID) {
            throw new InvestigationError(
              'protocol_violation',
              403,
              'This investigation can only run its scoped ES|QL tool'
            );
          }
        },
      },
    },
  });
};
