/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { IScopedClusterClient, Logger } from '@kbn/core/server';
import { DEFAULT_LOGS_PROFILE, MESSAGE_FIELD } from '@kbn/discover-utils';
import type {
  InvestigationScope,
  InvestigationTimeRange,
} from '../../common/selection_investigation';
import {
  INVESTIGATION_MAX_PROFILE_FIELDS,
  INVESTIGATION_MIN_FIELD_CARDINALITY,
  INVESTIGATION_QUERY_TIMEOUT_MS,
} from './constants';
import {
  CARDINALITY_COLUMN_PREFIX,
  composeFieldCardinalityQuery,
  type FrozenBaseQuery,
} from './query';

/**
 * A field the agent may group by, with what it needs to judge whether that is worth a probe:
 * a handful of distinct values discriminates, thousands scatter the change into noise.
 */
export interface CharacteristicField {
  name: string;
  type: string;
  /** Distinct values inside the investigated window, not across the whole index. */
  cardinality?: number;
}

export interface CoverageProfile {
  characteristicFields: CharacteristicField[];
  messageField?: { name: string; strategy: 'categorize' };
}

// Fields the logs profile recommends come first, so the agent starts from the ones that usually
// explain a change. `message` is excluded because it is handled separately, as a pattern field.
const preferredFields: string[] = DEFAULT_LOGS_PROFILE.recommendedFields.filter(
  (field) => field !== MESSAGE_FIELD
);
const messageFields = [MESSAGE_FIELD, 'body.text', 'error.message'];
const dimensionTypes = new Set([
  'keyword',
  'ip',
  'boolean',
  'byte',
  'short',
  'integer',
  'long',
  'unsigned_long',
]);

/**
 * The shortlist of fields the agent is allowed to group by, plus the message field if there is
 * one. Anything outside this list is rejected when a probe asks for it.
 */
export const resolveLogCoverageProfile = async ({
  esClient,
  source,
  timeField,
  signal,
}: {
  esClient: IScopedClusterClient;
  source: string;
  timeField: string;
  signal: AbortSignal;
}): Promise<CoverageProfile> => {
  // Schema discovery must preserve the requesting user's Elasticsearch privileges.
  const response = await esClient.asCurrentUser.fieldCaps(
    { index: source, fields: ['*'], include_unmapped: false },
    { signal, maxRetries: 0, requestTimeout: INVESTIGATION_QUERY_TIMEOUT_MS }
  );
  const fieldCaps = response.fields;

  const characteristicFields = Object.entries(fieldCaps)
    .flatMap(([field, types]): CharacteristicField[] => {
      if (field === timeField || messageFields.includes(field)) return [];
      const groupable = Object.entries(types).find(
        ([type, capabilities]) => dimensionTypes.has(type) && capabilities.aggregatable === true
      );

      return groupable ? [{ name: field, type: groupable[0] }] : [];
    })
    .sort((left, right) => {
      const leftRank = preferredFields.indexOf(left.name);
      const rightRank = preferredFields.indexOf(right.name);
      return leftRank !== -1 || rightRank !== -1
        ? (leftRank === -1 ? Number.MAX_SAFE_INTEGER : leftRank) -
            (rightRank === -1 ? Number.MAX_SAFE_INTEGER : rightRank)
        : left.name.localeCompare(right.name);
    })
    .slice(0, INVESTIGATION_MAX_PROFILE_FIELDS);
  const messageField = messageFields.find((field) => {
    const types = Object.keys(fieldCaps[field] ?? {});
    return types.length > 0 && types.every((type) => ['text', 'match_only_text'].includes(type));
  });

  return {
    characteristicFields,
    ...(messageField
      ? { messageField: { name: messageField, strategy: 'categorize' as const } }
      : {}),
  };
};

/**
 * Measures how many distinct values each field holds in the window. Constant fields are dropped —
 * grouping by them only repeats the total — and the counts stay on the survivors, because how
 * scattered a field is decides whether probing it can produce anything. Best effort: on failure
 * the profile is returned unchanged rather than failing the run.
 */
export const withFieldCardinality = async ({
  esClient,
  frozen,
  timeField,
  union,
  profile,
  scopes,
  signal,
  logger,
}: {
  esClient: IScopedClusterClient;
  frozen: FrozenBaseQuery;
  timeField: string;
  union: InvestigationTimeRange;
  profile: CoverageProfile;
  scopes: InvestigationScope[];
  signal: AbortSignal;
  logger: Logger;
}): Promise<CoverageProfile> => {
  const { characteristicFields } = profile;
  if (characteristicFields.length === 0) {
    return profile;
  }
  try {
    const response = await esClient.asCurrentUser.esql.query(
      {
        query: composeFieldCardinalityQuery({
          frozen,
          timeField,
          union,
          fields: characteristicFields.map(({ name }) => name),
          scopes,
        }),
      },
      { signal, maxRetries: 0, requestTimeout: INVESTIGATION_QUERY_TIMEOUT_MS }
    );
    const values = response.values[0] ?? [];
    // Matched by column name rather than position; an unrecognised column leaves its field as is.
    const cardinalityByField = new Map<string, number>();
    response.columns.forEach(({ name }, index) => {
      const field = characteristicFields[Number(name.slice(CARDINALITY_COLUMN_PREFIX.length))];
      const cardinality = values[index];
      if (field !== undefined && typeof cardinality === 'number') {
        cardinalityByField.set(field.name, cardinality);
      }
    });

    return {
      ...profile,
      characteristicFields: characteristicFields.flatMap((field) => {
        const cardinality = cardinalityByField.get(field.name);
        if (cardinality !== undefined && cardinality < INVESTIGATION_MIN_FIELD_CARDINALITY) {
          return [];
        }

        return [{ ...field, ...(cardinality !== undefined ? { cardinality } : {}) }];
      }),
    };
  } catch (error) {
    logger.warn(
      `Field cardinality gate skipped: ${error instanceof Error ? error.message : String(error)}`
    );

    return profile;
  }
};

const isScopeWithinProfile = (
  { field, value, mode }: InvestigationScope,
  profile: CoverageProfile
): boolean =>
  mode === 'rlike'
    ? typeof value === 'string' && profile.messageField?.name === field
    : profile.characteristicFields.some(({ name }) => name === field);

// Scopes arrive from the browser, so each one is re-checked against the profile the server just
// resolved, and the same field may not be used twice.
export const areScopesWithinProfile = (
  scopes: InvestigationScope[],
  profile: CoverageProfile
): boolean =>
  scopes.every((scope) => isScopeWithinProfile(scope, profile)) &&
  new Set(scopes.map(({ field }) => field)).size === scopes.length;
