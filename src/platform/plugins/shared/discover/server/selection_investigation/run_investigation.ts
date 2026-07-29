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
  isMessageChunkEvent,
  isPromptRequestEvent,
  isReasoningEvent,
  isRoundCompleteEvent,
  isToolCallEvent,
  isToolResultEvent,
} from '@kbn/agent-builder-common';
import type { AgentBuilderPluginStart } from '@kbn/agent-builder-server';
import type {
  InvestigationModelOutput,
  InvestigationRuntimeTimings,
} from '../../common/selection_investigation';
import { buildAgentInput, getInvestigationPlaybookForResolution } from './agent_input';
import {
  DISCOVER_INVESTIGATION_ESQL_TOOL_ID,
  INVESTIGATION_LOG_MESSAGE_PREVIEW_CHARS,
  INVESTIGATION_MODEL_OUTPUT_RESOLUTION,
  INVESTIGATION_SYNTHESIS_STALL_LOG_INTERVAL_MS,
} from './constants';
import type { EvidenceLedger } from './evidence';
import { finalizeInvestigation } from './finalize';
import { INVESTIGATION_OUTPUT_SCHEMA } from './model_output';
import { resolveInvestigationModelOutput } from './model_output_resolution';
import type { InvestigationExecutionPolicy } from './policy';
import { safeErrorEvent, toSseEvent } from './sse_events';
import {
  collectCitedEvidenceReferences,
  createInvestigationLogger,
  logFinalizeFailure,
} from './investigation_debug_log';

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
  const runStartedAt = Date.now();
  const log = createInvestigationLogger(logger, policy.runId, policy.context.requestId);
  log.info('Investigation run starting', {
    executionId,
    goalLength: policy.context.goal.length,
    filterCount: policy.context.filters.length,
    modelOutputResolution: INVESTIGATION_MODEL_OUTPUT_RESOLUTION,
  });

  try {
    const planningStep = { stepId: 'planning', phase: 'planning' as const };
    policy.onPhase(planningStep, 'start');
    let execution;
    const agentExecutionStartedAt = Date.now();
    try {
      log.debug('Calling Agent Builder executeAgent', { executionId });
      const useAgentBuilderStructuredOutput =
        INVESTIGATION_MODEL_OUTPUT_RESOLUTION === 'agent_builder_structured_output';
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
          structuredOutput: useAgentBuilderStructuredOutput,
          ...(useAgentBuilderStructuredOutput ? { outputSchema: INVESTIGATION_OUTPUT_SCHEMA } : {}),
          capabilities: { visualizations: false },
          configurationOverrides: {
            instructions: getInvestigationPlaybookForResolution(
              INVESTIGATION_MODEL_OUTPUT_RESOLUTION
            ),
            tools: [{ tool_ids: [DISCOVER_INVESTIGATION_ESQL_TOOL_ID] }],
            skill_ids: [],
            enable_elastic_capabilities: false,
          },
        },
      });
      log.info('Agent Builder execution handle acquired', {
        executionId,
        ms: Date.now() - agentExecutionStartedAt,
      });
    } catch (error) {
      policy.onPhase(planningStep, 'failure');
      log.error('executeAgent failed before event stream', error as Error, {
        ms: Date.now() - agentExecutionStartedAt,
      });
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
    const toolCallStartedAt = new Map<string, number>();
    let synthesisStartedAt: number | undefined;
    let lastAgentEventAt = agentExecutionStartedAt;
    let synthesisStallLogInterval: ReturnType<typeof setInterval> | undefined;
    let synthesisFinished = false;
    let streamSettled = false;
    let awaitingVerificationToolCalls = false;

    const probesIdle = () =>
      pendingToolCalls.exploration.size === 0 && pendingToolCalls.verification.size === 0;

    const handoverStreamingMayHaveStarted = () => {
      if (!probesIdle()) {
        return false;
      }
      if (verificationCompletedAt !== undefined) {
        return true;
      }
      return (
        explorationCompletedAt !== undefined &&
        completedWaves.has('exploration') &&
        !awaitingVerificationToolCalls
      );
    };

    const maybeStartHandoverSynthesisFromStream = () => {
      if (
        INVESTIGATION_MODEL_OUTPUT_RESOLUTION !== 'agent_builder_handover_json' ||
        synthesisStarted ||
        !handoverStreamingMayHaveStarted()
      ) {
        return;
      }
      startSynthesis();
    };

    const stopSynthesisWatchdog = () => {
      if (synthesisStallLogInterval !== undefined) {
        clearInterval(synthesisStallLogInterval);
        synthesisStallLogInterval = undefined;
      }
    };

    const startSynthesisWatchdog = () => {
      stopSynthesisWatchdog();
      synthesisStallLogInterval = setInterval(() => {
        if (synthesisFinished || streamSettled) {
          stopSynthesisWatchdog();
          return;
        }
        log.warn('Synthesis stall: no Agent Builder progress event', {
          synthesisMs:
            synthesisStartedAt !== undefined ? Date.now() - synthesisStartedAt : undefined,
          elapsedRunMs: elapsedRunMs(),
          elapsedAgentMs: elapsedAgentMs(),
          msSinceLastAgentEvent: Date.now() - lastAgentEventAt,
          executionId,
          abortReason: executionAbortController.signal.aborted
            ? executionAbortController.signal.reason
            : undefined,
        });
      }, INVESTIGATION_SYNTHESIS_STALL_LOG_INTERVAL_MS);
    };

    const elapsedAgentMs = () => Date.now() - agentExecutionStartedAt;
    const elapsedRunMs = () => Date.now() - runStartedAt;

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
        log.debug('Ignoring tool call without investigation wave', {
          toolCallId: event.data.tool_call_id,
          params: event.data.params,
          elapsedAgentMs: elapsedAgentMs(),
        });
        return;
      }

      toolCallStartedAt.set(event.data.tool_call_id, Date.now());
      log.info('Investigation probe tool call', {
        wave,
        toolCallId: event.data.tool_call_id,
        toolCallGroupId: event.data.tool_call_group_id,
        label: event.data.params.label,
        metricColumn: event.data.params.metricColumn,
        keyColumn: event.data.params.keyColumn,
        elapsedAgentMs: elapsedAgentMs(),
      });

      const now = Date.now();
      decisionGroups.add(event.data.tool_call_group_id ?? wave);
      toolCallWaves.set(event.data.tool_call_id, wave);
      pendingToolCalls[wave].add(event.data.tool_call_id);
      if (wave === 'exploration' && planningAndSetupMs === undefined) {
        planningAndSetupMs = now - agentExecutionStartedAt;
      }
      if (wave === 'verification') {
        awaitingVerificationToolCalls = false;
        if (verificationDecisionMs === undefined) {
          verificationDecisionMs = now - (explorationCompletedAt ?? agentExecutionStartedAt);
        }
      }
    };

    const recordToolResult = (toolCallId: string) => {
      const startedAt = toolCallStartedAt.get(toolCallId);
      const wave = toolCallWaves.get(toolCallId);
      if (wave) {
        log.info('Investigation probe tool result', {
          wave,
          toolCallId,
          probeMs: startedAt !== undefined ? Date.now() - startedAt : undefined,
          elapsedAgentMs: elapsedAgentMs(),
          ledgerEvidenceCount: ledger.listEvidenceReferences().length,
        });
      }
      toolCallStartedAt.delete(toolCallId);
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
        awaitingVerificationToolCalls = true;
        log.info('Exploration probe wave completed', {
          elapsedAgentMs: elapsedAgentMs(),
          ledgerEvidence: ledger.listEvidenceReferences(),
        });
      } else {
        verificationCompletedAt = Date.now();
        log.info('Verification probe wave completed', {
          elapsedAgentMs: elapsedAgentMs(),
          ledgerEvidence: ledger.listEvidenceReferences(),
        });
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
    const startSynthesis = () => {
      if (!synthesisStarted) {
        synthesisStarted = true;
        synthesisStartedAt = Date.now();
        policy.onPhase(synthesisStep, 'start');
        log.info('Synthesis phase started', {
          resolution: INVESTIGATION_MODEL_OUTPUT_RESOLUTION,
          elapsedAgentMs: elapsedAgentMs(),
          elapsedRunMs: elapsedRunMs(),
          sinceLastProbeMs:
            verificationCompletedAt !== undefined || explorationCompletedAt !== undefined
              ? Date.now() - (verificationCompletedAt ?? explorationCompletedAt!)
              : undefined,
          ledgerEvidence: ledger.listEvidenceReferences(),
        });
        startSynthesisWatchdog();
      }
    };
    const finishSynthesis = (status: 'success' | 'failure') => {
      if (synthesisStarted && !synthesisFinished) {
        synthesisFinished = true;
        stopSynthesisWatchdog();
        policy.onPhase(synthesisStep, status);
        log.info('Synthesis phase finished', {
          status,
          synthesisMs:
            synthesisStartedAt !== undefined ? Date.now() - synthesisStartedAt : undefined,
          elapsedAgentMs: elapsedAgentMs(),
          elapsedRunMs: elapsedRunMs(),
        });
      }
    };
    const settleStream = (writeTerminalEvent: () => void) => {
      if (streamSettled) {
        return;
      }
      streamSettled = true;
      stopSynthesisWatchdog();
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
        lastAgentEventAt = Date.now();
        log.debug('Agent Builder event', {
          eventType: event.type,
          elapsedAgentMs: elapsedAgentMs(),
        });

        if (isToolCallEvent(event) || isMessageCompleteEvent(event)) {
          finishPlanning('success');
        }
        if (isToolCallEvent(event)) {
          recordToolCall(event);
        }
        if (isToolResultEvent(event)) {
          recordToolResult(event.data.tool_call_id);
        }
        if (isMessageChunkEvent(event)) {
          maybeStartHandoverSynthesisFromStream();
        }
        // Agent Builder emits a transient reasoning event when its answer agent starts. Waiting
        // until a probe has completed distinguishes it from the research agent's initial event.
        if (
          isReasoningEvent(event) &&
          event.data.transient &&
          INVESTIGATION_MODEL_OUTPUT_RESOLUTION === 'agent_builder_structured_output' &&
          (explorationCompletedAt !== undefined || verificationCompletedAt !== undefined)
        ) {
          startSynthesis();
        }
        if (isPromptRequestEvent(event)) {
          log.warn('Agent requested user prompt during investigation; aborting with protocol', {
            elapsedAgentMs: elapsedAgentMs(),
            elapsedRunMs: elapsedRunMs(),
          });
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
        if (isMessageCompleteEvent(event)) {
          agentExecutionCompletedAt = Date.now();
          const probesCompleted =
            explorationCompletedAt !== undefined || verificationCompletedAt !== undefined;

          if (
            INVESTIGATION_MODEL_OUTPUT_RESOLUTION === 'agent_builder_handover_json' &&
            probesCompleted
          ) {
            startSynthesis();
          }

          const resolveResult = resolveInvestigationModelOutput({
            payload: {
              structuredOutput: event.data.structured_output,
              messageContent: event.data.message_content,
            },
          });

          if (INVESTIGATION_MODEL_OUTPUT_RESOLUTION === 'agent_builder_structured_output') {
            if (event.data.structured_output) {
              startSynthesis();
            } else {
              log.warn('Agent Builder message_complete without structured_output', {
                elapsedAgentMs: elapsedAgentMs(),
                elapsedRunMs: elapsedRunMs(),
                messageContentLength: event.data.message_content.length,
                messagePreview: event.data.message_content.slice(
                  0,
                  INVESTIGATION_LOG_MESSAGE_PREVIEW_CHARS
                ),
              });
            }
          }

          if (resolveResult.ok) {
            modelOutput = resolveResult.data;
            finishSynthesis('success');
            log.info('Investigation model output resolved', {
              source: resolveResult.source,
              elapsedAgentMs: elapsedAgentMs(),
              elapsedRunMs: elapsedRunMs(),
              timings: getRuntimeTimings(),
              cited: collectCitedEvidenceReferences(resolveResult.data),
            });
          } else if (resolveResult.code !== 'missing_payload') {
            finishSynthesis('failure');
            log.warn('Investigation model output resolution failed', {
              source: resolveResult.source,
              code: resolveResult.code,
              message: resolveResult.message,
              elapsedAgentMs: elapsedAgentMs(),
              elapsedRunMs: elapsedRunMs(),
              zodError: resolveResult.zodError,
              messagePreview: event.data.message_content.slice(
                0,
                INVESTIGATION_LOG_MESSAGE_PREVIEW_CHARS
              ),
            });
          } else if (
            INVESTIGATION_MODEL_OUTPUT_RESOLUTION === 'agent_builder_handover_json' &&
            probesCompleted
          ) {
            finishSynthesis('failure');
          }
        }
        if (isRoundCompleteEvent(event)) {
          log.info('Agent Builder round_complete', {
            elapsedAgentMs: elapsedAgentMs(),
            elapsedRunMs: elapsedRunMs(),
            roundStatus: event.data.round.status,
            hasStructuredOutput: event.data.round.response?.structured_output !== undefined,
          });
        }
      },
      error: (error: Error) => {
        finishPlanning('failure');
        finishSynthesis('failure');
        settleStream(() => {
          if (executionAbortController.signal.aborted) {
            const reason =
              executionAbortController.signal.reason === 'timeout'
                ? 'timeout'
                : executionAbortController.signal.reason === 'protocol'
                ? 'protocol'
                : 'client';
            log.warn('Investigation aborted', {
              reason,
              elapsedRunMs: elapsedRunMs(),
              elapsedAgentMs: elapsedAgentMs(),
              synthesisStarted,
              synthesisMs:
                synthesisStartedAt !== undefined ? Date.now() - synthesisStartedAt : undefined,
              hadModelOutput: modelOutput !== undefined,
              ledgerEvidence: ledger.listEvidenceReferences(),
            });
          } else {
            log.error('Agent Builder event stream error', error, {
              elapsedRunMs: elapsedRunMs(),
              elapsedAgentMs: elapsedAgentMs(),
            });
          }
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
            log.warn('Agent completed without valid investigation model output', {
              elapsedRunMs: elapsedRunMs(),
              elapsedAgentMs: elapsedAgentMs(),
              synthesisStarted,
              resolution: INVESTIGATION_MODEL_OUTPUT_RESOLUTION,
              ledgerEvidence: ledger.listEvidenceReferences(),
            });
            output$.next(
              toSseEvent({
                type: 'investigation_error',
                data: { code: 'model_output_invalid' },
              })
            );
          } else {
            try {
              const result = finalizeInvestigation({
                ledger,
                modelOutput,
              });
              log.info('Investigation finalized successfully', {
                elapsedRunMs: elapsedRunMs(),
                findingCount: result.findings.length,
                answerStatus: result.answer.status,
                timings: getRuntimeTimings(),
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
            } catch (error) {
              logFinalizeFailure({
                log,
                error,
                ledger,
                modelOutput,
                elapsedMs: elapsedRunMs(),
              });
              output$.next(toSseEvent(safeErrorEvent(error as Error)));
            }
          }
        });
      },
    });
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    log.error('Investigation run failed before streaming', normalizedError, {
      elapsedRunMs: Date.now() - runStartedAt,
    });
    if (!output$.closed) {
      output$.next(toSseEvent(safeErrorEvent(normalizedError)));
      output$.complete();
    }
    onSettled();
  }
};
