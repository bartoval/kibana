/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { buildPath, isHttpFetchError } from '@kbn/core-http-browser';
import type { HttpStart } from '@kbn/core/public';
import { SavedObjectNotFound } from '@kbn/kibana-utils-plugin/public';
import { SavedSearchType } from '@kbn/saved-search-plugin/common';
import {
  DISCOVER_SESSION_API_BASE_PATH,
  DISCOVER_SESSION_API_VERSION,
} from '../../../common/constants';
import type { DiscoverSessionResolve } from '../../../common/discover_session_api';
import type {
  DiscoverSessionApiDataInput,
  DiscoverSessionApiResponse,
  DiscoverSessionGetResponse,
} from '../../../server';

export type DiscoverSessionGetResult = DiscoverSessionGetResponse & {
  resolve: DiscoverSessionResolve;
};

export interface DiscoverSessionClient {
  get: (id: string) => Promise<DiscoverSessionGetResult>;
  create: (data: DiscoverSessionApiDataInput) => Promise<DiscoverSessionApiResponse>;
  upsert: (id: string, data: DiscoverSessionApiDataInput) => Promise<DiscoverSessionApiResponse>;
}

const buildDiscoverSessionPath = (id: string): string =>
  buildPath(`${DISCOVER_SESSION_API_BASE_PATH}/{id}`, { id });

const throwGetError = (error: unknown, id: string): never => {
  if (isHttpFetchError(error) && error.response?.status === 404) {
    throw new SavedObjectNotFound({
      type: SavedSearchType,
      typeDisplayName: 'Discover session',
      id,
    });
  }

  throw error;
};

export const createDiscoverSessionClient = (http: HttpStart): DiscoverSessionClient => ({
  get: async (id) => {
    const { body, response } = await http
      .get<DiscoverSessionGetResponse>(buildDiscoverSessionPath(id), {
        version: DISCOVER_SESSION_API_VERSION,
        asResponse: true,
      })
      .catch((error) => throwGetError(error, id));
    const outcome = response?.headers.get('kbn-resolve-outcome') ?? undefined;
    const aliasPurpose = response?.headers.get('kbn-resolve-purpose') ?? undefined;

    return {
      ...body,
      resolve: {
        outcome: outcome as DiscoverSessionResolve['outcome'],
        aliasTargetId: response?.headers.get('kbn-resolve-alias-target-id') ?? undefined,
        aliasPurpose: aliasPurpose as DiscoverSessionResolve['aliasPurpose'],
      },
    };
  },
  create: (data) =>
    http.post<DiscoverSessionApiResponse>(DISCOVER_SESSION_API_BASE_PATH, {
      version: DISCOVER_SESSION_API_VERSION,
      body: JSON.stringify(data),
    }),
  upsert: (id, data) =>
    http.put<DiscoverSessionApiResponse>(buildDiscoverSessionPath(id), {
      version: DISCOVER_SESSION_API_VERSION,
      body: JSON.stringify(data),
    }),
});
