/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { ServerSentEvent } from '@kbn/sse-utils';
import { isAgentExecutionError } from '@kbn/agent-builder-common';
import type { SelectionInvestigationSseEvent } from '../../common/selection_investigation';
import { isInvestigationError } from './errors';

// Mirrors getSSEResponseHeaders() in the Agent Builder plugin. Kept local because importing it
// from that plugin's route utils would pull @kbn/connector-specs into the Discover server graph.
export const SSE_RESPONSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream',
  'Content-Encoding': 'identity',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'Transfer-Encoding': 'chunked',
  'X-Content-Type-Options': 'nosniff',
  'X-Accel-Buffering': 'no',
};

export const toSseEvent = (event: SelectionInvestigationSseEvent): ServerSentEvent =>
  event as ServerSentEvent;

export const safeErrorEvent = (error: Error): SelectionInvestigationSseEvent => {
  if (isAgentExecutionError(error)) {
    return {
      type: 'investigation_error',
      data: { code: error.meta.errCode, message: error.message },
    };
  }
  return {
    type: 'investigation_error',
    data: {
      code: isInvestigationError(error) ? error.code : 'execution_failed',
      message: error.message,
    },
  };
};
