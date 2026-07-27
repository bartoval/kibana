/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { Parser } from '@elastic/esql';
import type { IScopedClusterClient } from '@kbn/core/server';
import { getCategorizationField } from '@kbn/aiops-utils';
import { DEFAULT_LOGS_PROFILE, MESSAGE_FIELD } from '@kbn/discover-utils';
import {
  formatESQLColumns,
  getESQLWithSafeLimit,
  getIndexPatternFromESQLQuery,
  isESQLColumnGroupable,
} from '@kbn/esql-utils';
import type {
  InvestigationTimeRange,
  SelectionInvestigationRequest,
} from '../../common/selection_investigation';
import { INVESTIGATION_MAX_PROFILE_FIELDS } from './constants';
import { InvestigationError } from './errors';
import { executeInvestigationEsql } from './esql_executor';

interface InvestigationField {
  name: string;
  type: string;
  recommended?: true;
}

export interface InvestigationSchemaProfile {
  fields: InvestigationField[];
  messageField?: { name: string };
}

const recommendedFields = new Set<string>(
  DEFAULT_LOGS_PROFILE.recommendedFields.filter((field) => field !== MESSAGE_FIELD)
);
const messageFieldTypes = new Set(['text', 'match_only_text']);
const timeFieldTypes = new Set(['date', 'date_nanos']);

/**
 * Protects comparisons from truncated populations and source indices the time filter would
 * silently skip.
 */
const validateInvestigationScope = async ({
  esClient,
  query,
  timeField,
}: {
  esClient: IScopedClusterClient;
  query: string;
  timeField: string;
}): Promise<void> => {
  const { root, errors } = Parser.parseQuery(query);
  if (errors.length > 0) {
    throw new InvestigationError('invalid_context', 400, 'The Discover query is not valid');
  }

  // Temporary POC boundary: reject pre-limited scopes instead of guessing whether LIMIT is
  // presentation-only. A production contract can preserve limits proven safe for comparison.
  if (root.commands.some(({ name }) => name === 'limit')) {
    throw new InvestigationError(
      'invalid_context',
      400,
      'Remove LIMIT from the Discover query before starting an investigation'
    );
  }

  const index = getIndexPatternFromESQLQuery(query);
  if (!index) {
    throw new InvestigationError(
      'invalid_context',
      400,
      'The Discover query must read from an index'
    );
  }

  const response = await esClient.asCurrentUser.fieldCaps({
    index,
    fields: [timeField],
    include_unmapped: true,
    ignore_unavailable: true,
    allow_no_indices: true,
  });
  const capabilities = response.fields?.[timeField];
  const mappedTypes = Object.keys(capabilities ?? {}).filter((type) => type !== 'unmapped');
  const hasUnmappedIndices = Boolean(capabilities?.unmapped?.indices?.length);

  // The external range filter silently excludes indices without this field.
  if (
    mappedTypes.length === 0 ||
    mappedTypes.some((type) => !timeFieldTypes.has(type)) ||
    hasUnmappedIndices
  ) {
    throw new InvestigationError(
      'invalid_context',
      400,
      `The time field "${timeField}" must be a date field on every index in this Discover query`
    );
  }
};

/**
 * Gives the model a bounded view of the columns produced by the active Discover query. It is
 * guidance for writing queries, not a server-owned list of investigation strategies.
 */
export const resolveInvestigationProfile = async ({
  esClient,
  query,
  union,
  context,
  signal,
}: {
  esClient: IScopedClusterClient;
  query: string;
  union: InvestigationTimeRange;
  context: SelectionInvestigationRequest;
  signal: AbortSignal;
}): Promise<InvestigationSchemaProfile> => {
  await validateInvestigationScope({
    esClient,
    query,
    timeField: context.timeField,
  });

  const { response } = await executeInvestigationEsql({
    esClient,
    query: getESQLWithSafeLimit(query, 0),
    timeRange: union,
    context,
    signal,
  });
  const columns = response.columns;
  const messageFields = columns
    .filter(({ type }) => messageFieldTypes.has(type))
    .map(({ name }) => name)
    .sort((left, right) => left.localeCompare(right));
  const messageField = getCategorizationField(messageFields);
  const messageFieldNames = new Set(messageFields);
  const fields = formatESQLColumns(columns)
    .flatMap((column): InvestigationField[] => {
      const type = column.meta?.esType;
      if (
        column.name === context.timeField ||
        messageFieldNames.has(column.name) ||
        !type ||
        !isESQLColumnGroupable(column)
      ) {
        return [];
      }
      return [
        {
          name: column.name,
          type,
          ...(recommendedFields.has(column.name) ? { recommended: true as const } : {}),
        },
      ];
    })
    .sort(
      (left, right) =>
        Number(Boolean(right.recommended)) - Number(Boolean(left.recommended)) ||
        left.name.localeCompare(right.name)
    )
    .slice(0, INVESTIGATION_MAX_PROFILE_FIELDS);

  return {
    fields,
    ...(messageField ? { messageField: { name: messageField } } : {}),
  };
};
