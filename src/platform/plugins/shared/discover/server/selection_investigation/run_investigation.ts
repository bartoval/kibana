/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { KibanaRequest, Logger } from '@kbn/core/server';
import type { Subject } from 'rxjs';
import type { ServerSentEvent } from '@kbn/sse-utils';
import {
  AgentExecutionMode,
  agentBuilderDefaultAgentId,
  isMessageCompleteEvent,
  isPromptRequestEvent,
  isReasoningEvent,
  isToolCallEvent,
  isToolResultEvent,
} from '@kbn/agent-builder-common';
import type { AgentBuilderPluginStart } from '@kbn/agent-builder-server';
import type {
  InvestigationModelOutput,
  InvestigationRuntimeTimings,
} from '../../common/selection_investigation';
import { INVESTIGATION_PLAYBOOK, buildAgentInput } from './agent_input';
import { DISCOVER_INVESTIGATION_ESQL_TOOL_ID } from './constants';
import type { EvidenceLedger } from './evidence';
import { finalizeInvestigation } from './finalize';
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
  request: KibanaRequest;
  agentBuilder: AgentBuilderPluginStart;
  executionId: string;
  executionAbortController: AbortController;
  output$: Subject<ServerSentEvent>;
  logger: Logger;
  onSettled: () => void;
}): Promise<void> => {
  try {
    const planningStep = { stepId: 'planning', phase: 'planning' as const };
    policy.onPhase(planningStep, 'start');
    let execution;
    const agentExecutionStartedAt = Date.now();
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
    let agentExecutionCompletedAt: number | undefined;
    let planningAndSetupMs: number | undefined;
    let verificationDecisionMs: number | undefined;
    let explorationCompletedAt: number | undefined;
    let verificationCompletedAt: number | undefined;
    const decisionGroups = new Set<string>();
    const toolCallWaves = new Map<string, 'exploration' | 'verification'>();
    const pendingToolCalls = {
      exploration: new Set<string>(),
      verification: new Set<string>(),
    };
    const completedWaves = new Set<'exploration' | 'verification'>();

    const recordToolCall = (event: {
      data: {
        tool_call_id: string;
        tool_call_group_id?: string;
        params: Record<string, unknown>;
      };
    }) => {
      const wave =
        event.data.params.wave === 'exploration' || event.data.params.wave === 'verification'
          ? event.data.params.wave
          : undefined;
      if (!wave) {
        return;
      }

      const now = Date.now();
      decisionGroups.add(event.data.tool_call_group_id ?? wave);
      toolCallWaves.set(event.data.tool_call_id, wave);
      pendingToolCalls[wave].add(event.data.tool_call_id);
      if (wave === 'exploration' && planningAndSetupMs === undefined) {
        planningAndSetupMs = now - agentExecutionStartedAt;
      }
      if (wave === 'verification' && verificationDecisionMs === undefined) {
        verificationDecisionMs = now - (explorationCompletedAt ?? agentExecutionStartedAt);
      }
    };

    const recordToolResult = (toolCallId: string) => {
      const wave = toolCallWaves.get(toolCallId);
      if (!wave) {
        return;
      }
      pendingToolCalls[wave].delete(toolCallId);
      if (pendingToolCalls[wave].size > 0 || completedWaves.has(wave)) {
        return;
      }
      completedWaves.add(wave);
      if (wave === 'exploration') {
        explorationCompletedAt = Date.now();
      } else {
        verificationCompletedAt = Date.now();
      }
    };

    const getRuntimeTimings = (): InvestigationRuntimeTimings => {
      const completedAt = agentExecutionCompletedAt ?? Date.now();
      const finalProbeCompletedAt = verificationCompletedAt ?? explorationCompletedAt;
      return {
        ...(planningAndSetupMs !== undefined ? { planningAndSetupMs } : {}),
        ...(verificationDecisionMs !== undefined ? { verificationDecisionMs } : {}),
        ...(finalProbeCompletedAt !== undefined
          ? { handoffAndSynthesisMs: completedAt - finalProbeCompletedAt }
          : {}),
        totalAgentMs: completedAt - agentExecutionStartedAt,
        investigativeDecisionCount: decisionGroups.size,
      };
    };

    let planningFinished = false;
    const finishPlanning = (status: 'success' | 'failure') => {
      if (!planningFinished) {
        planningFinished = true;
        policy.onPhase(planningStep, status);
      }
    };
    const synthesisStep = { stepId: 'synthesis', phase: 'synthesis' as const };
    let synthesisStarted = false;
    let synthesisFinished = false;
    const startSynthesis = () => {
      if (!synthesisStarted) {
        synthesisStarted = true;
        policy.onPhase(synthesisStep, 'start');
      }
    };
    const finishSynthesis = (status: 'success' | 'failure') => {
      if (synthesisStarted && !synthesisFinished) {
        synthesisFinished = true;
        policy.onPhase(synthesisStep, status);
      }
    };
    let streamSettled = false;
    const settleStream = (writeTerminalEvent: () => void) => {
      if (streamSettled) {
        return;
      }
      streamSettled = true;
      try {
        if (!output$.closed) {
          writeTerminalEvent();
        }
      } catch (error) {
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        logger.error(normalizedError);
        if (!output$.closed) {
          output$.next(toSseEvent(safeErrorEvent(normalizedError)));
        }
      } finally {
        if (!output$.closed) {
          output$.complete();
        }
        onSettled();
      }
    };

    execution.events$.subscribe({
      next: (event) => {
        if (isToolCallEvent(event) || isMessageCompleteEvent(event)) {
          finishPlanning('success');
        }
        if (isToolCallEvent(event)) {
          recordToolCall(event);
        }
        if (isToolResultEvent(event)) {
          recordToolResult(event.data.tool_call_id);
        }
        // Agent Builder emits a transient reasoning event when its answer agent starts. Waiting
        // until a probe has completed distinguishes it from the research agent's initial event.
        if (
          isReasoningEvent(event) &&
          event.data.transient &&
          (explorationCompletedAt !== undefined || verificationCompletedAt !== undefined)
        ) {
          startSynthesis();
        }
        if (isPromptRequestEvent(event)) {
          executionAbortController.abort('protocol');
          finishSynthesis('failure');
          settleStream(() => {
            output$.next(
              toSseEvent({
                type: 'aborted',
                data: { reason: 'protocol' },
              })
            );
          });
          return;
        }
        if (isMessageCompleteEvent(event) && event.data.structured_output) {
          startSynthesis();
          finishSynthesis('success');
          agentExecutionCompletedAt = Date.now();
          const parsed = investigationModelOutputSchema.safeParse(event.data.structured_output);
          if (parsed.success) {
            modelOutput = parsed.data;
          }
        }
      },
      error: (error: Error) => {
        finishPlanning('failure');
        finishSynthesis('failure');
        settleStream(() => {
          logger.error(error);
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
        });
      },
      complete: () => {
        settleStream(() => {
          if (!modelOutput) {
            output$.next(
              toSseEvent({
                type: 'investigation_error',
                data: { code: 'structured_output_invalid' },
              })
            );
          } else {
            const result = finalizeInvestigation({
              ledger,
              modelOutput,
            });
            output$.next(
              toSseEvent({
                type: 'completed',
                data: {
                  ...result,
                  timings: getRuntimeTimings(),
                },
              })
            );
          }
        });
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
