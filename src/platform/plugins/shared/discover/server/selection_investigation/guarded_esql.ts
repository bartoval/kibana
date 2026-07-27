/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { FieldValue } from '@elastic/elasticsearch/lib/api/types';
import { Parser } from '@elastic/esql';
import type { IScopedClusterClient } from '@kbn/core-elasticsearch-server';
import { ToolType, type ToolResult } from '@kbn/agent-builder-common';
import type { BuiltinToolDefinition } from '@kbn/agent-builder-server';
import { createOtherResult } from '@kbn/agent-builder-server';
import { z } from '@kbn/zod/v4';
import type { InvestigationProgressStep } from '../../common/selection_investigation';
import { DISCOVER_INVESTIGATION_ESQL_TOOL_ID } from './constants';
import { createEvidenceRecord, isComparableEvidenceRow, type EvidenceValue } from './evidence';
import { InvestigationError } from './errors';
import { executeInvestigationEsql } from './esql_executor';
import {
  getInvestigationPolicy,
  type InvestigationExecutionPolicy,
  type InvestigationProbeWave,
} from './policy';

const toolSchema = z
  .object({
    wave: z.enum(['exploration', 'verification']),
    pipeline: z
      .string()
      .trim()
      .optional()
      .describe(
        'Optional ES|QL pipeline to append to the frozen Discover query. Use ES|QL aliases such as `STATS event_count = COUNT(*) BY host.keyword`, never SQL `AS`. Omit it to compare the current query output directly.'
      ),
    keyColumn: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe(
        'Column that uniquely identifies comparable rows. Omit only when the query returns one scalar row.'
      ),
    metricColumn: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe('Numeric column whose values should be compared between the two periods.'),
    label: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .describe('Short user-facing description of what this query checks.'),
    rationale: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .describe('One sentence explaining why this query advances the investigation mission.'),
  })
  .strict();

type GuardedToolInput = z.infer<typeof toolSchema>;

const INVESTIGATION_TOOL_DESCRIPTION = `Append an analysis pipeline to the frozen Discover query
and compare its numeric result over the selected and equal-length previous periods. Discover applies
both time ranges and frozen filters outside the ES|QL text.

Choose queries from the mission, available columns, and prior results rather than a fixed field
order. Work in at most two waves: issue one to three independent exploration calls together, then
zero to two verification calls for the strongest lead or most important gap. Do not repeat queries.

For raw events, produce a numeric STATS metric with stable aliases, then normally SORT and LIMIT.
Use ES|QL assignment syntax such as
\`STATS event_count = COUNT(*) BY host.keyword | SORT event_count DESC | LIMIT 10\`; never SQL AS.
Use quoted LIKE or RLIKE patterns, not JavaScript /regex/ literals, and do not invent functions.
When the frozen query already returns aggregates, compare its numeric metric instead of counting
the aggregate rows.

A rejected query says nothing about field availability; correct it when budget remains. Empty or
constant output means only that the check was not useful. Rows marked requiresVerification are
one-sided bounded results and deliberately have no evidenceRowId. Verify an exact key with a scalar
aggregation before claiming it appeared or disappeared; otherwise omit it. To prove absence, use an
aggregation that returns numeric zero rather than an empty result.

When focus is present, re-check that previous lead. Narrow dimension values with
\`WHERE MV_CONTAINS(field, value::field_type)\` because Elasticsearch fields may be single- or
multi-valued. If all focused checks are empty, correct the filter or report that the lead could not
be reproduced.`;

const composeQuery = (baseQuery: string, pipeline?: string): string => {
  const normalizedPipeline = pipeline?.replace(/^\s*\|\s*/, '').trim();
  const query = normalizedPipeline ? `${baseQuery.trim()}\n| ${normalizedPipeline}` : baseQuery;
  let parserError: string | undefined;
  try {
    const { errors } = Parser.parseQuery(query);
    if (errors.length === 0) {
      return query;
    }
    parserError = errors[0]?.message;
  } catch {
    // Report all parser failures through the tool contract below.
  }
  throw new InvestigationError(
    'query_rejected',
    400,
    parserError ? `Invalid ES|QL: ${parserError}` : 'The proposed ES|QL query is not valid'
  );
};

const columnIndex = (columns: Array<{ name: string }>, name: string): number => {
  const index = columns.findIndex((column) => column.name === name);
  if (index === -1) {
    throw new InvestigationError(
      'query_rejected',
      400,
      `The query did not return the declared column "${name}"`
    );
  }
  return index;
};

const evidenceValue = (value: FieldValue): EvidenceValue => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  throw new InvestigationError(
    'query_rejected',
    400,
    'The evidence key must be a scalar string, number, boolean, or null'
  );
};

const numericValue = (value: FieldValue, metricColumn: string): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  throw new InvestigationError(
    'query_rejected',
    400,
    `The declared metric column "${metricColumn}" must contain finite numbers`
  );
};

const normalizePeriod = ({
  columns,
  values,
  keyColumn,
  metricColumn,
}: {
  columns: Array<{ name: string }>;
  values: FieldValue[][];
  keyColumn?: string;
  metricColumn: string;
}): Map<string, { key: EvidenceValue; value: number }> => {
  const metricIndex = columnIndex(columns, metricColumn);
  const keyIndex = keyColumn ? columnIndex(columns, keyColumn) : -1;
  if (!keyColumn && values.length > 1) {
    throw new InvestigationError(
      'query_rejected',
      400,
      'A comparison without a key column must return at most one row per period'
    );
  }

  const normalized = new Map<string, { key: EvidenceValue; value: number }>();
  values.forEach((row) => {
    const key = keyColumn ? evidenceValue(row[keyIndex]) : ('total' as const);
    const id = `${key === null ? 'null' : typeof key}:${String(key)}`;
    if (normalized.has(id)) {
      throw new InvestigationError(
        'query_rejected',
        400,
        `The declared key column "${keyColumn}" does not uniquely identify result rows`
      );
    }
    normalized.set(id, { key, value: numericValue(row[metricIndex], metricColumn) });
  });
  return normalized;
};

const mergePeriods = (
  selection: Map<string, { key: EvidenceValue; value: number }>,
  baseline: Map<string, { key: EvidenceValue; value: number }>
) => {
  const selectionIds = [...selection.keys()];
  const baselineIds = [...baseline.keys()];
  const ids: string[] = [];
  const seen = new Set<string>();

  // Preserve both query orderings so the server does not rank findings, while still including
  // values that were returned by only one period.
  for (let index = 0; index < Math.max(selectionIds.length, baselineIds.length); index++) {
    for (const id of [selectionIds[index], baselineIds[index]]) {
      if (id !== undefined && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }

  return ids.map((id) => ({
    key: selection.get(id)?.key ?? baseline.get(id)?.key ?? null,
    selectionValue: selection.get(id)?.value ?? null,
    baselineValue: baseline.get(id)?.value ?? null,
  }));
};

const executeGuardedInvestigationQuery = async ({
  policy,
  esClient,
  wave,
  pipeline,
  keyColumn,
  metricColumn,
  label,
  rationale,
}: {
  policy: InvestigationExecutionPolicy;
  esClient: IScopedClusterClient;
  wave: InvestigationProbeWave;
  pipeline?: string;
  keyColumn?: string;
  metricColumn: string;
  label: string;
  rationale: string;
}) => {
  let query: string;
  try {
    query = composeQuery(policy.context.query, pipeline);
  } catch (error) {
    policy.recordRejection();
    throw error;
  }
  const signature = JSON.stringify({ query, keyColumn: keyColumn ?? null, metricColumn });
  let releaseProbe: () => void;
  try {
    releaseProbe = policy.beginProbe({ wave, signature });
  } catch (error) {
    policy.recordRejection();
    throw error;
  }
  let comparison: number;
  try {
    comparison = policy.reserveComparison();
  } catch (error) {
    releaseProbe();
    throw error;
  }

  const progressStep: Omit<InvestigationProgressStep, 'status'> = {
    stepId: `query-${comparison}`,
    phase: 'query',
    wave,
    label,
    rationale,
  };
  policy.onPhase(progressStep, 'start');
  const pairAbortController = new AbortController();
  const signal = AbortSignal.any([policy.signal, pairAbortController.signal]);
  const periodRequests = [
    executeInvestigationEsql({
      esClient,
      query,
      timeRange: policy.ledger.selection,
      context: policy.context,
      signal,
    }),
    executeInvestigationEsql({
      esClient,
      query,
      timeRange: policy.ledger.baseline,
      context: policy.context,
      signal,
    }),
  ] as const;

  try {
    const [selectionResult, baselineResult] = await Promise.all(periodRequests);
    const selection = normalizePeriod({
      ...selectionResult.response,
      keyColumn,
      metricColumn,
    });
    const baseline = normalizePeriod({
      ...baselineResult.response,
      keyColumn,
      metricColumn,
    });
    const record = createEvidenceRecord({
      runId: policy.runId,
      query,
      keyColumn,
      metricColumn,
      selection: policy.ledger.selection,
      baseline: policy.ledger.baseline,
      filterCount: policy.context.filters.length,
      esqlExecutionMs: Math.max(selectionResult.executionMs, baselineResult.executionMs),
      values: mergePeriods(selection, baseline),
    });
    policy.ledger.add(record);
    policy.onPhase(
      {
        ...progressStep,
        result: {
          rowCount: record.rows.length,
          esqlExecutionMs: record.esqlExecutionMs,
        },
      },
      'success'
    );
    return record;
  } catch (error) {
    pairAbortController.abort('paired_query_failed');
    await Promise.allSettled(periodRequests);
    policy.onPhase(progressStep, 'failure');
    throw error;
  } finally {
    releaseProbe();
  }
};

const toolResult = (
  record: Awaited<ReturnType<typeof executeGuardedInvestigationQuery>>,
  policy: InvestigationExecutionPolicy,
  wave: InvestigationProbeWave
) =>
  createOtherResult({
    evidenceId: record.evidenceId,
    comparisonsRemaining: policy.remainingComparisonsAfterWave(wave),
    rows: record.rows.map((row) =>
      isComparableEvidenceRow(row)
        ? row
        : {
            key: row.key,
            selectionValue: row.selectionValue,
            baselineValue: row.baselineValue,
            requiresVerification: true,
          }
    ),
  });

export const createGuardedEsqlTool = (): BuiltinToolDefinition<typeof toolSchema, ToolResult> => ({
  id: DISCOVER_INVESTIGATION_ESQL_TOOL_ID,
  type: ToolType.builtin,
  schema: toolSchema,
  tags: ['discover', 'investigation', 'esql'],
  description: INVESTIGATION_TOOL_DESCRIPTION,
  confirmation: { askUser: 'never' },
  handler: async (input: GuardedToolInput, { esClient, request }) => {
    const policy = getInvestigationPolicy(request);
    if (!policy) {
      throw new InvestigationError(
        'protocol_violation',
        403,
        'Discover investigation context is not active'
      );
    }
    const record = await executeGuardedInvestigationQuery({
      policy,
      esClient,
      ...input,
    });
    return { results: [toolResult(record, policy, input.wave)] };
  },
});
