/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { IScopedClusterClient, KibanaRequest, Logger } from '@kbn/core/server';
import type { Subject } from 'rxjs';
import type { ServerSentEvent } from '@kbn/sse-utils';
import {
  AgentExecutionMode,
  agentBuilderDefaultAgentId,
  isMessageCompleteEvent,
  isPromptRequestEvent,
  isToolCallEvent,
} from '@kbn/agent-builder-common';
import type { AgentBuilderPluginStart } from '@kbn/agent-builder-server';
import type { InvestigationModelOutput } from '../../common/selection_investigation';
import { INVESTIGATION_PLAYBOOK, buildAgentInput } from './agent_input';
import { DISCOVER_INVESTIGATION_ESQL_TOOL_ID } from './constants';
import type { EvidenceLedger } from './evidence';
import { finalizeInvestigation, getComparisonCoverageIssue } from './finalize';
import { executeGuardedInvestigationQuery } from './guarded_esql';
import { INVESTIGATION_OUTPUT_SCHEMA, investigationModelOutputSchema } from './model_output';
import type { InvestigationExecutionPolicy } from './policy';
import { safeErrorEvent, toSseEvent } from './sse_events';

/**
 * Runs one investigation to completion and reports it on `output$`. Never rejects: every ending,
 * including failure, is delivered as an event and then settles the run exactly once.
 */
export const runInvestigation = async ({
  policy,
  ledger,
  esClient,
  request,
  agentBuilder,
  executionId,
  executionAbortController,
  output$,
  logger,
  onSettled,
}: {
  policy: InvestigationExecutionPolicy;
  ledger: EvidenceLedger;
  esClient: IScopedClusterClient;
  request: KibanaRequest;
  agentBuilder: AgentBuilderPluginStart;
  executionId: string;
  executionAbortController: AbortController;
  output$: Subject<ServerSentEvent>;
  logger: Logger;
  onSettled: () => void;
}): Promise<void> => {
  try {
    await executeGuardedInvestigationQuery({
      policy,
      esClient,
      purpose: 'total',
    });
    const coverageIssue = getComparisonCoverageIssue(ledger);
    if (coverageIssue) {
      output$.next(
        toSseEvent({
          type: 'completed',
          data: {
            outcome: 'insufficient_evidence',
            findings: [],
            insufficientEvidenceReason: coverageIssue,
          },
        })
      );
      output$.complete();
      onSettled();
      return;
    }
    const planningStep = { stepId: 'planning', phase: 'planning' as const };
    policy.onPhase(planningStep, 'start');
    let execution;
    try {
      execution = await agentBuilder.execution.executeAgent({
        request,
        mode: AgentExecutionMode.conversation,
        // The execution policy lives in this process's memory and the route streams the
        // run synchronously, so the execution has to stay local rather than be scheduled.
        useTaskManager: false,
        abortSignal: executionAbortController.signal,
        executionId,
        metadata: {
          purpose: 'discover-selection-investigation',
          requestId: policy.context.requestId,
        },
        params: {
          agentId: agentBuilderDefaultAgentId,
          nextInput: {
            message: buildAgentInput(policy),
          },
          storeConversation: false,
          structuredOutput: true,
          outputSchema: INVESTIGATION_OUTPUT_SCHEMA,
          capabilities: { visualizations: false },
          configurationOverrides: {
            instructions: INVESTIGATION_PLAYBOOK,
            tools: [{ tool_ids: [DISCOVER_INVESTIGATION_ESQL_TOOL_ID] }],
            skill_ids: [],
            enable_elastic_capabilities: false,
          },
        },
      });
    } catch (error) {
      policy.onPhase(planningStep, 'failure');
      throw error;
    }

    let modelOutput: InvestigationModelOutput | undefined;
    let planningFinished = false;
    const finishPlanning = (status: 'success' | 'failure') => {
      if (!planningFinished) {
        planningFinished = true;
        policy.onPhase(planningStep, status);
      }
    };
    execution.events$.subscribe({
      next: (event) => {
        if (isToolCallEvent(event) || isMessageCompleteEvent(event)) {
          finishPlanning('success');
        }
        if (isPromptRequestEvent(event)) {
          executionAbortController.abort('protocol');
          if (!output$.closed) {
            output$.next(
              toSseEvent({
                type: 'aborted',
                data: { reason: 'protocol' },
              })
            );
            output$.complete();
          }
          return;
        }
        if (isMessageCompleteEvent(event) && event.data.structured_output) {
          const parsed = investigationModelOutputSchema.safeParse(event.data.structured_output);
          if (parsed.success) {
            modelOutput = parsed.data;
          }
        }
      },
      error: (error: Error) => {
        finishPlanning('failure');
        logger.error(error);
        if (!output$.closed) {
          if (executionAbortController.signal.aborted) {
            output$.next(
              toSseEvent({
                type: 'aborted',
                data: {
                  reason:
                    executionAbortController.signal.reason === 'timeout'
                      ? 'timeout'
                      : executionAbortController.signal.reason === 'protocol'
                      ? 'protocol'
                      : 'client',
                },
              })
            );
          } else {
            output$.next(toSseEvent(safeErrorEvent(error)));
          }
          output$.complete();
        }
        onSettled();
      },
      complete: () => {
        if (!output$.closed) {
          if (!modelOutput) {
            output$.next(
              toSseEvent({
                type: 'investigation_error',
                data: { code: 'structured_output_invalid' },
              })
            );
          } else {
            output$.next(
              toSseEvent({
                type: 'completed',
                data: finalizeInvestigation({
                  ledger,
                  modelOutput,
                  baseScopes: policy.context.scopes ?? [],
                }),
              })
            );
          }
          output$.complete();
        }
        onSettled();
      },
    });
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    logger.error(normalizedError);
    if (!output$.closed) {
      output$.next(toSseEvent(safeErrorEvent(normalizedError)));
      output$.complete();
    }
    onSettled();
  }
};
