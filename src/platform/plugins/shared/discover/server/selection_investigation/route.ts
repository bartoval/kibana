/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { v4 as uuidv4 } from 'uuid';
import type { CoreSetup, IRouter, Logger, RequestHandlerContext } from '@kbn/core/server';
import type { ServerSentEvent } from '@kbn/sse-utils';
import { cloudProxyBufferSize, observableIntoEventSourceStream } from '@kbn/sse-utils-server';
import { apiPrivileges } from '@kbn/agent-builder-plugin/common/features';
import { ReplaySubject, type Subscription } from 'rxjs';
import {
  SELECTION_INVESTIGATION_ROUTE,
  type SelectionInvestigationRequest,
} from '../../common/selection_investigation';
import type { DiscoverServerPluginStartDeps } from '..';
import { INVESTIGATION_MAX_BODY_BYTES, INVESTIGATION_RUN_TIMEOUT_MS } from './constants';
import { requestSchema } from './request_schema';
import { SSE_RESPONSE_HEADERS, toSseEvent } from './sse_events';
import { runInvestigation } from './run_investigation';
import { InvestigationExecutionPolicy, registerInvestigationPolicy } from './policy';
import { resolveInvestigationProfile } from './profile';
import { InvestigationError, isInvestigationError } from './errors';
import { EvidenceLedger } from './evidence';

const calculateRanges = (selection: {
  from: string;
  to: string;
}): {
  selection: { from: string; to: string };
  baseline: { from: string; to: string };
} => {
  const from = Date.parse(selection.from);
  const to = Date.parse(selection.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    throw new InvestigationError(
      'invalid_context',
      400,
      'Selection must be a non-empty absolute time range'
    );
  }
  return {
    selection: {
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
    },
    baseline: {
      from: new Date(from - (to - from)).toISOString(),
      to: new Date(from).toISOString(),
    },
  };
};

export const registerSelectionInvestigationRoute = ({
  router,
  getStartServices,
  logger,
}: {
  router: IRouter<RequestHandlerContext>;
  getStartServices: CoreSetup<DiscoverServerPluginStartDeps>['getStartServices'];
  logger: Logger;
}): void => {
  router.post(
    {
      path: SELECTION_INVESTIGATION_ROUTE,
      security: {
        authz: {
          requiredPrivileges: [apiPrivileges.readAgentBuilder],
        },
      },
      options: {
        access: 'internal',
        body: { maxBytes: INVESTIGATION_MAX_BODY_BYTES },
        timeout: { idleSocket: INVESTIGATION_RUN_TIMEOUT_MS + 30_000 },
      },
      validate: {
        body: requestSchema,
      },
    },
    async (context, request, response) => {
      const [, startDeps] = await getStartServices();
      if (!startDeps.agentBuilder) {
        return response.customError({
          statusCode: 503,
          body: {
            message: 'Connector unavailable',
            attributes: { code: 'connector_unavailable' },
          },
        });
      }
      const body = request.body as SelectionInvestigationRequest;

      let releasePolicy: (() => void) | undefined;
      let requestAbortSubscription: Subscription | undefined;
      let runTimeout: ReturnType<typeof setTimeout> | undefined;
      let transportReleased = false;
      const releaseTransportOnce = () => {
        if (transportReleased) {
          return;
        }
        transportReleased = true;
        if (runTimeout) {
          clearTimeout(runTimeout);
        }
        requestAbortSubscription?.unsubscribe();
      };
      let policyReleased = false;
      const releasePolicyOnce = () => {
        if (policyReleased) {
          return;
        }
        policyReleased = true;
        releasePolicy?.();
      };
      const releaseOnce = () => {
        releaseTransportOnce();
        releasePolicyOnce();
      };
      try {
        const ranges = calculateRanges(body.selection);
        const goal = body.goal.trim();
        if (!goal) {
          throw new InvestigationError('invalid_context', 400, 'An investigation goal is required');
        }
        const normalizedBody = { ...body, goal, selection: ranges.selection };
        const coreContext = await context.core;

        const executionAbortController = new AbortController();
        const responseAbortController = new AbortController();
        // Baseline and `started` events can be emitted before the HTTP response subscribes.
        // Keep a small bounded replay so the client receives the complete foreground lifecycle.
        const output$ = new ReplaySubject<ServerSentEvent>(32);
        const executionId = uuidv4();
        const runId = executionId;
        const ledger = new EvidenceLedger(runId, ranges.selection, ranges.baseline);
        const profile = await resolveInvestigationProfile({
          esClient: coreContext.elasticsearch.client,
          query: normalizedBody.query,
          union: { from: ranges.baseline.from, to: ranges.selection.to },
          context: normalizedBody,
          signal: executionAbortController.signal,
        });
        const policy = new InvestigationExecutionPolicy({
          runId,
          context: normalizedBody,
          profile,
          ledger,
          signal: executionAbortController.signal,
          onPhase: (step, status) => {
            if (!output$.closed) {
              output$.next(toSseEvent({ type: 'phase', data: { ...step, status } }));
            }
          },
        });
        releasePolicy = registerInvestigationPolicy(request, policy);

        // Disconnect and timeout close the transport immediately. The policy stays registered until
        // Agent Builder settles, so a late tool call is still denied by the request-scoped hook.
        runTimeout = setTimeout(() => {
          executionAbortController.abort('timeout');
          if (!output$.closed) {
            output$.next(toSseEvent({ type: 'aborted', data: { reason: 'timeout' } }));
            output$.complete();
          }
          // Keep the policy active until Agent Builder settles so no late built-in tool can run.
          releaseTransportOnce();
        }, INVESTIGATION_RUN_TIMEOUT_MS);
        requestAbortSubscription = request.events.aborted$.subscribe(() => {
          executionAbortController.abort('client');
          responseAbortController.abort('client');
          output$.complete();
          releaseTransportOnce();
        });

        output$.next(
          toSseEvent({
            type: 'started',
            data: {
              requestId: normalizedBody.requestId,
              selection: ranges.selection,
              baseline: ranges.baseline,
            },
          })
        );

        // The investigation itself is deliberately not awaited: the handler returns the stream
        // straight away, and the work below keeps pushing events into it until it is done.
        void runInvestigation({
          policy,
          ledger,
          request,
          agentBuilder: startDeps.agentBuilder,
          executionId,
          executionAbortController,
          output$,
          logger,
          onSettled: releaseOnce,
        });

        return response.ok({
          headers: SSE_RESPONSE_HEADERS,
          body: observableIntoEventSourceStream(output$, {
            signal: responseAbortController.signal,
            flushMinBytes: cloudProxyBufferSize,
            logger,
          }),
        });
      } catch (error) {
        releaseOnce();
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        logger.error(normalizedError);
        if (isInvestigationError(normalizedError)) {
          return response.customError({
            statusCode: normalizedError.statusCode,
            body: {
              message: normalizedError.message,
              attributes: { code: normalizedError.code },
            },
          });
        }
        return response.customError({
          statusCode: 500,
          body: {
            message: 'Investigation request failed',
            attributes: { code: 'execution_failed' },
          },
        });
      }
    }
  );
};
