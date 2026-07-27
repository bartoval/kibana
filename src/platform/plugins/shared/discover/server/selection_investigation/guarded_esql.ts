/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { z } from '@kbn/zod/v4';
import type { EsqlESQLParams, FieldValue } from '@elastic/elasticsearch/lib/api/types';
import type { IScopedClusterClient } from '@kbn/core-elasticsearch-server';
import { buildEsQuery } from '@kbn/es-query';
import { getNamedParams } from '@kbn/esql-utils';
import { ToolType, type ToolResult } from '@kbn/agent-builder-common';
import type { BuiltinToolDefinition, RunContext } from '@kbn/agent-builder-server';
import { createOtherResult, getAgentFromRunContext } from '@kbn/agent-builder-server';
import type { InvestigationPhase, InvestigationScope } from '../../common/selection_investigation';
import type {
  ChangeMass,
  EvidenceInputRow,
  EvidenceLedger,
  EvidencePurpose,
  EvidenceValue,
} from './evidence';
import { createEvidenceRecord } from './evidence';
import { InvestigationError } from './errors';
import {
  DISCOVER_INVESTIGATION_ESQL_TOOL_ID,
  INVESTIGATION_MAX_CONTEXT_STRING_CHARS,
  INVESTIGATION_MAX_RESPONSE_BYTES,
  INVESTIGATION_QUERY_TIMEOUT_MS,
} from './constants';
import { getInvestigationPolicy, type InvestigationExecutionPolicy } from './policy';
import { composeInvestigationQuery, freezeDiscoverQuery } from './query';

const evidenceReferenceSchema = z.object({
  evidenceId: z.string().min(1).max(100),
  evidenceRowId: z.string().min(1).max(100),
});

const toolSchema = z.object({
  purpose: z.enum(['contributors', 'patterns']),
  field: z.string().min(1).max(INVESTIGATION_MAX_CONTEXT_STRING_CHARS),
  scope: evidenceReferenceSchema.optional(),
});

type GuardedToolInput = z.infer<typeof toolSchema>;

const getExecutionId = (runContext: RunContext): string | undefined =>
  getAgentFromRunContext(runContext)?.executionId;

const columnIndex = (columns: Array<{ name: string }>, name: string): number => {
  const index = columns.findIndex((column) => column.name === name);
  if (index === -1) {
    throw new InvestigationError('execution_failed', 500, `Guarded ES|QL did not return ${name}`);
  }
  return index;
};

const normalizeRows = ({
  columns,
  values,
  keyColumn,
}: {
  columns: Array<{ name: string }>;
  values: FieldValue[][];
  keyColumn?: string;
}): { rows: EvidenceInputRow[]; comparisonChangeMass?: ChangeMass } => {
  const selectionIndex = columnIndex(columns, 'selection_count');
  const baselineIndex = columnIndex(columns, 'baseline_count');
  if (values.length === 0) {
    return { rows: keyColumn ? [] : [{ key: 'total', selectionCount: 0, baselineCount: 0 }] };
  }
  const keyIndex = keyColumn ? columnIndex(columns, keyColumn) : -1;
  const numberAt = (row: FieldValue[], index: number) =>
    typeof row[index] === 'number' ? row[index] : 0;
  const keyAt = (row: FieldValue[]): EvidenceValue => {
    const value = row[keyIndex];
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? value
      : null;
  };
  const rows = values.map((row) => ({
    key: keyColumn ? keyAt(row) : 'total',
    selectionCount: numberAt(row, selectionIndex),
    baselineCount: numberAt(row, baselineIndex),
  }));
  if (!keyColumn) return { rows: rows.slice(0, 1) };
  const positiveIndex = columnIndex(columns, 'investigation_positive_mass');
  const negativeIndex = columnIndex(columns, 'investigation_negative_mass');
  return {
    rows,
    // Movement across every group, not just the ten rows kept — Elasticsearch sums it before the
    // cut-off. Kept split by direction: a row that fell is a share of what fell, not of what rose.
    comparisonChangeMass: {
      positive: numberAt(values[0], positiveIndex),
      negative: numberAt(values[0], negativeIndex),
    },
  };
};

const fieldAllowedForPurpose = (
  policy: InvestigationExecutionPolicy,
  purpose: EvidencePurpose,
  field: string
): boolean => {
  if (purpose === 'contributors') {
    return policy.profile.characteristicFields.some(({ name }) => name === field);
  }

  return policy.profile.messageField?.name === field;
};

/**
 * Why the server would turn a probe away, or nothing if it may run. Every reason here is settled
 * before Elasticsearch is touched, which is what lets a refusal cost no query budget.
 */
const refuseProbeRequest = ({
  policy,
  purpose,
  field,
  scope,
  resolvedScope,
}: {
  policy: InvestigationExecutionPolicy;
  purpose: EvidencePurpose;
  field?: string;
  scope?: { evidenceId: string; evidenceRowId: string };
  resolvedScope: ReturnType<EvidenceLedger['resolve']> | undefined;
}): string | undefined => {
  if (purpose !== 'total' && (!field || !fieldAllowedForPurpose(policy, purpose, field))) {
    return 'Probe field is outside the server-resolved log profile';
  }
  if (scope && (!resolvedScope || resolvedScope.record.purpose === 'total')) {
    return 'Probe scope must reference existing non-total evidence from this investigation';
  }
  const scopedFields = new Set(policy.context.scopes?.map(({ field: scopeField }) => scopeField));
  let currentScope = resolvedScope;
  while (currentScope) {
    scopedFields.add(currentScope.record.dimension);
    currentScope = currentScope.record.scope
      ? policy.ledger.resolve(currentScope.record.scope) ?? undefined
      : undefined;
  }
  if (field && scopedFields.has(field)) {
    return 'Probe field is already fixed by the current investigation scope';
  }
  if (scope && !policy.ledger.isScopeNarrowing(scope)) {
    return 'Probe scope does not narrow the current investigation population';
  }
};

export const executeGuardedInvestigationQuery = async ({
  policy,
  esClient,
  purpose,
  field,
  scope,
}: {
  policy: InvestigationExecutionPolicy;
  esClient: IScopedClusterClient;
  purpose: EvidencePurpose;
  field?: string;
  scope?: { evidenceId: string; evidenceRowId: string };
}) => {
  const resolvedScope = scope ? policy.ledger.resolve(scope) : undefined;
  const refusal = refuseProbeRequest({ policy, purpose, field, scope, resolvedScope });
  if (refusal) {
    policy.recordRejection();
    throw new InvestigationError('query_rejected', 400, refusal);
  }
  policy.reserveAttempt();

  const phase: InvestigationPhase = purpose;
  const progressStep = {
    stepId: `${purpose}-${policy.attempts}`,
    phase,
    ...(field ? { field } : {}),
    ...(resolvedScope
      ? {
          scope: {
            field: resolvedScope.record.dimension,
            value: resolvedScope.row.key,
          },
        }
      : {}),
  };
  policy.onPhase(progressStep, 'start');
  try {
    const frozen = freezeDiscoverQuery(policy.context.query);
    const evidenceScope: InvestigationScope | undefined = resolvedScope
      ? {
          field: resolvedScope.record.dimension,
          value: resolvedScope.row.key,
          mode: resolvedScope.record.purpose === 'patterns' ? 'rlike' : 'equals',
        }
      : undefined;
    const composed = composeInvestigationQuery({
      frozen,
      timeField: policy.context.timeField,
      selection: policy.ledger.selection,
      baseline: policy.ledger.baseline,
      field,
      total: purpose === 'total',
      categorize: purpose === 'patterns',
      scopes: [...(policy.context.scopes ?? []), ...(evidenceScope ? [evidenceScope] : [])],
    });
    const params = getNamedParams(
      composed.query,
      undefined,
      Object.values(policy.context.variables)
    );
    const filter =
      policy.context.filters.length > 0
        ? buildEsQuery(undefined, [], policy.context.filters)
        : undefined;
    const queryTimeoutController = new AbortController();
    const queryTimeout = setTimeout(
      () => queryTimeoutController.abort('query_timeout'),
      INVESTIGATION_QUERY_TIMEOUT_MS
    );
    queryTimeout.unref?.();
    const signal = AbortSignal.any([policy.signal, queryTimeoutController.signal]);
    // Investigation probes run with the user's Elasticsearch privileges; they never elevate.
    const response = await esClient.asCurrentUser.esql
      .query(
        {
          query: composed.query,
          ...(params.length > 0 ? { params: params as EsqlESQLParams } : {}),
          ...(filter ? { filter } : {}),
        },
        {
          signal,
          requestTimeout: INVESTIGATION_QUERY_TIMEOUT_MS,
          maxRetries: 0,
          maxResponseSize: INVESTIGATION_MAX_RESPONSE_BYTES,
        }
      )
      .finally(() => clearTimeout(queryTimeout));

    const normalized = normalizeRows({
      ...response,
      ...(purpose === 'total'
        ? {}
        : { keyColumn: purpose === 'patterns' ? 'investigation_pattern' : field! }),
    });
    const record = createEvidenceRecord({
      runId: policy.runId,
      purpose,
      dimension: purpose === 'total' ? 'total' : field!,
      query: composed.query,
      documentsQuery: composed.documentsQuery,
      selection: policy.ledger.selection,
      baseline: policy.ledger.baseline,
      inputRows: normalized.rows,
      comparisonChangeMass: normalized.comparisonChangeMass,
      filterCount: policy.context.filters.length + frozen.whereCount,
      documentsFilterMode: purpose === 'patterns' ? 'rlike' : 'equals',
      scopeReference: scope,
    });
    policy.ledger.add(record);
    policy.onPhase(progressStep, 'success');
    return record;
  } catch (error) {
    policy.onPhase(progressStep, 'failure');
    throw error;
  }
};

const toolResult = (
  record: Awaited<ReturnType<typeof executeGuardedInvestigationQuery>>,
  ledger: EvidenceLedger
) =>
  createOtherResult({
    evidenceId: record.evidenceId,
    purpose: record.purpose,
    dimension: record.dimension,
    scope: record.scope,
    query: record.query,
    rows: record.rows.map(
      ({
        evidenceRowId,
        typedKey,
        selectionCount,
        baselineCount,
        delta,
        absoluteChange,
        relativeChange,
        poissonNormalizedChange,
        candidateShare,
        direction,
        material,
      }) => ({
        evidenceRowId,
        typedKey,
        selectionCount,
        baselineCount,
        delta,
        absoluteChange,
        relativeChange,
        poissonNormalizedChange,
        candidateShare,
        direction,
        material,
        scopeEligible: ledger.isScopeNarrowing({
          evidenceId: record.evidenceId,
          evidenceRowId,
        }),
      })
    ),
  });

export const createGuardedEsqlTool = (): BuiltinToolDefinition<typeof toolSchema, ToolResult> => ({
  id: DISCOVER_INVESTIGATION_ESQL_TOOL_ID,
  type: ToolType.builtin,
  schema: toolSchema,
  tags: ['discover', 'investigation', 'esql'],
  description:
    'Run one bounded comparison probe. A probe can be scoped to a row returned by an earlier probe.',
  confirmation: { askUser: 'never' },
  handler: async ({ purpose, field, scope }: GuardedToolInput, { esClient, runContext }) => {
    const executionId = getExecutionId(runContext);
    const policy = executionId ? getInvestigationPolicy(executionId) : undefined;
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
      purpose,
      field,
      scope,
    });
    return { results: [toolResult(record, policy.ledger)] };
  },
});
