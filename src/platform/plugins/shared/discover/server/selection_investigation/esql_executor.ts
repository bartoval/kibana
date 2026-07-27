/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type {
  EsqlESQLParams,
  EsqlQueryResponse,
  QueryDslQueryContainer,
} from '@elastic/elasticsearch/lib/api/types';
import type { IScopedClusterClient } from '@kbn/core-elasticsearch-server';
import { buildEsQuery } from '@kbn/es-query';
import { getNamedParams } from '@kbn/esql-utils';
import type {
  InvestigationTimeRange,
  SelectionInvestigationRequest,
} from '../../common/selection_investigation';
import { INVESTIGATION_MAX_RESPONSE_BYTES, INVESTIGATION_QUERY_TIMEOUT_MS } from './constants';

type InvestigationQueryContext = Pick<
  SelectionInvestigationRequest,
  'filters' | 'variables' | 'timeField'
>;

const buildRequestFilter = (
  context: InvestigationQueryContext,
  timeRange: InvestigationTimeRange
): QueryDslQueryContainer => {
  const clauses: QueryDslQueryContainer[] = [
    {
      range: {
        [context.timeField]: {
          gte: timeRange.from,
          lt: timeRange.to,
        },
      },
    },
  ];
  if (context.filters.length > 0) {
    clauses.push(buildEsQuery(undefined, [], context.filters));
  }
  return { bool: { filter: clauses } };
};

// The ES|QL text stays untouched; Discover owns the filters that define each compared period.
export const executeInvestigationEsql = async ({
  esClient,
  query,
  timeRange,
  context,
  signal: runSignal,
}: {
  esClient: IScopedClusterClient;
  query: string;
  timeRange: InvestigationTimeRange;
  context: InvestigationQueryContext;
  signal: AbortSignal;
}): Promise<{ response: EsqlQueryResponse; executionMs: number }> => {
  const params = getNamedParams(query, timeRange, context.variables);
  const filter = buildRequestFilter(context, timeRange);
  const queryTimeoutController = new AbortController();
  const queryTimeout = setTimeout(
    () => queryTimeoutController.abort('query_timeout'),
    INVESTIGATION_QUERY_TIMEOUT_MS
  );
  queryTimeout.unref?.();
  const signal = AbortSignal.any([runSignal, queryTimeoutController.signal]);
  const startedAt = Date.now();

  try {
    const response = await esClient.asCurrentUser.esql.query(
      {
        query,
        filter,
        allow_partial_results: false,
        // Schema profiling needs null-only columns to remain in `columns`.
        drop_null_columns: false,
        ...(params.length > 0 ? { params: params as EsqlESQLParams } : {}),
      },
      {
        signal,
        requestTimeout: INVESTIGATION_QUERY_TIMEOUT_MS,
        maxRetries: 0,
        maxResponseSize: INVESTIGATION_MAX_RESPONSE_BYTES,
      }
    );

    return {
      response,
      executionMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(queryTimeout);
  }
};
