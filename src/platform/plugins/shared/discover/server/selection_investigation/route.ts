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
import { ReplaySubject, type Subscription } from 'rxjs';
import { apiPrivileges } from '@kbn/agent-builder-plugin/common/features';
import type { SelectionInvestigationRequest } from '../../common/selection_investigation';
import { SELECTION_INVESTIGATION_ROUTE } from '../../common';
import type { DiscoverServerPluginStartDeps } from '..';
import { INVESTIGATION_MAX_BODY_BYTES, INVESTIGATION_RUN_TIMEOUT_MS } from './constants';
import { requestSchema } from './request_schema';
import { SSE_RESPONSE_HEADERS, toSseEvent } from './sse_events';
import { runInvestigation } from './run_investigation';
import { InvestigationExecutionPolicy, registerInvestigationPolicy } from './policy';
import { areScopesWithinProfile, resolveLogCoverageProfile, withFieldCardinality } from './profile';
import { InvestigationError, isInvestigationError } from './errors';
import { EvidenceLedger } from './evidence';
import { freezeDiscoverQuery } from './query';

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
      try {
        const ranges = calculateRanges(body.selection);
        const normalizedBody = { ...body, selection: ranges.selection };
        const frozen = freezeDiscoverQuery(normalizedBody.query);
        const coreContext = await context.core;

        const executionAbortController = new AbortController();
        const responseAbortController = new AbortController();
        // Baseline and `started` events can be emitted before the HTTP response subscribes.
        // Keep a small bounded replay so the client receives the complete foreground lifecycle.
        const output$ = new ReplaySubject<ServerSentEvent>(32);
        const executionId = uuidv4();
        const runId = executionId;
        const ledger = new EvidenceLedger(runId, ranges.selection, ranges.baseline);
        const profile = await resolveLogCoverageProfile({
          esClient: coreContext.elasticsearch.client,
          source: frozen.source,
          timeField: normalizedBody.timeField,
          signal: executionAbortController.signal,
        });
        if (normalizedBody.scopes && !areScopesWithinProfile(normalizedBody.scopes, profile)) {
          throw new InvestigationError(
            'invalid_context',
            400,
            'The investigation scopes are outside the server-resolved log profile'
          );
        }
        const discriminatingProfile = await withFieldCardinality({
          esClient: coreContext.elasticsearch.client,
          frozen,
          timeField: normalizedBody.timeField,
          union: { from: ranges.baseline.from, to: ranges.selection.to },
          profile,
          scopes: normalizedBody.scopes ?? [],
          signal: executionAbortController.signal,
          logger,
        });
        if (
          discriminatingProfile.characteristicFields.length === 0 &&
          discriminatingProfile.messageField === undefined
        ) {
          throw new InvestigationError(
            'invalid_context',
            400,
            'The ES|QL source does not match the bounded log profile'
          );
        }
        const policy = new InvestigationExecutionPolicy({
          runId,
          context: normalizedBody,
          profile: discriminatingProfile,
          ledger,
          signal: executionAbortController.signal,
          onPhase: (step, status) => {
            if (!output$.closed) {
              output$.next(toSseEvent({ type: 'phase', data: { ...step, status } }));
            }
          },
        });
        releasePolicy = registerInvestigationPolicy(executionId, policy);

        // An investigation can end four ways: it finishes, it errors, the browser goes away, or it
        // runs out of time. Whichever happens first, the clean-up below must run exactly once.
        let released = false;
        const releaseOnce = () => {
          if (released) {
            return;
          }
          released = true;
          clearTimeout(runTimeout);
          requestAbortSubscription?.unsubscribe();
          releasePolicy?.();
        };

        requestAbortSubscription = request.events.aborted$.subscribe(() => {
          executionAbortController.abort('client');
          responseAbortController.abort('client');
          output$.complete();
        });
        const runTimeout = setTimeout(() => {
          executionAbortController.abort('timeout');
          if (!output$.closed) {
            output$.next(toSseEvent({ type: 'aborted', data: { reason: 'timeout' } }));
            output$.complete();
          }
        }, INVESTIGATION_RUN_TIMEOUT_MS);

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
        // Not awaited: the handler returns the stream immediately and the run keeps pushing
        // events into it until it settles.
        void runInvestigation({
          policy,
          ledger,
          esClient: coreContext.elasticsearch.client,
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
        releasePolicy?.();
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
