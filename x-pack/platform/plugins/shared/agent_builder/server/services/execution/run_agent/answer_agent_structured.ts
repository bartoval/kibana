/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod/v4';
import type { InferenceChatModel } from '@kbn/inference-langchain';
import type { AgentEventEmitter } from '@kbn/agent-builder-server';
import { createReasoningEvent } from '@kbn/agent-builder-genai-utils/langchain';
import { wrapJsonSchema } from '@kbn/agent-builder-genai-utils/tools/utils/json_schema';
import type { Logger } from '@kbn/logging';
import { convertError, isRecoverableError } from './utils/errors';
import { errorAction, isAgentErrorAction } from './actions';
import type { PromptFactory } from './prompts';
import { getRandomAnsweringMessage } from './i18n';
import { tags } from './constants';
import type { StateType } from './state';
import { processStructuredAnswerResponse } from './action_utils';

const structuredOutputZodSchema = z.object({
  response: z.string().describe("The response to the user's query"),
  data: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Optional structured data to include in the response'),
});

const { $schema: _$schema, ...structuredOutputSchema } = z.toJSONSchema(structuredOutputZodSchema, {
  io: 'input',
  unrepresentable: 'any',
}) as Record<string, unknown>;

export { structuredOutputSchema };

const wrappedSchemaProp = 'response';

/**
 * Structured output answer agent with structured error handling.
 * This agent uses structured output mode and returns structured error responses.
 */
export const createAnswerAgentStructured = ({
  chatModel,
  promptFactory,
  events,
  outputSchema,
  logger,
}: {
  chatModel: InferenceChatModel;
  events: AgentEventEmitter;
  promptFactory: PromptFactory;
  outputSchema?: Record<string, unknown>;
  logger: Logger;
}) => {
  return async (state: StateType) => {
    if (state.answerActions.length === 0 && state.errorCount === 0) {
      events.emit(createReasoningEvent(getRandomAnsweringMessage(), { transient: true }));
    }
    const invokeStartedAt = Date.now();
    logger.info(
      `[answer-agent-structured] structured output invoke starting priorErrorCount=${state.errorCount} priorAnswerActionCount=${state.answerActions.length}`
    );
    try {
      const { schema: schemaToUse, wrapped } = wrapJsonSchema({
        schema: outputSchema ?? structuredOutputSchema,
        property: wrappedSchemaProp,
        description:
          "Use this structured format to respond to the user's request with the required data.",
      });

      const structuredModel = chatModel
        .withStructuredOutput(schemaToUse, {
          name: 'structured_answer',
        })
        .withConfig({
          tags: [tags.agent, tags.answerAgent],
        });

      const prompt = await promptFactory.getStructuredAnswerPrompt({
        actions: state.mainActions,
        answerActions: state.answerActions,
        cycleLimit: state.cycleLimit,
      });

      let response = await structuredModel.invoke(prompt);
      // unwrap response if schema was wrapped
      if (wrapped && response[wrappedSchemaProp]) {
        response = response[wrappedSchemaProp];
      }

      const action = processStructuredAnswerResponse(response);

      if (isAgentErrorAction(action)) {
        logger.warn(
          `[answer-agent-structured] structured response rejected for retry invokeMs=${
            Date.now() - invokeStartedAt
          } errCode=${action.error.meta.errCode} agentErrorCount=${state.errorCount} message=${
            action.error.message
          }`
        );
      } else {
        logger.info(
          `[answer-agent-structured] structured output invoke succeeded invokeMs=${
            Date.now() - invokeStartedAt
          }`
        );
      }

      return {
        answerActions: [action],
        errorCount: 0,
      };
    } catch (error) {
      const executionError = convertError(error);
      logger.warn(
        `[answer-agent-structured] structured output invoke failed invokeMs=${
          Date.now() - invokeStartedAt
        } errCode=${executionError.meta.errCode} recoverable=${isRecoverableError(
          executionError
        )} nextErrorCount=${
          isRecoverableError(executionError) ? state.errorCount + 1 : state.errorCount
        } message=${executionError.message}`
      );
      if (isRecoverableError(executionError)) {
        return {
          answerActions: [errorAction(executionError)],
          errorCount: state.errorCount + 1,
        };
      } else {
        throw executionError;
      }
    }
  };
};
