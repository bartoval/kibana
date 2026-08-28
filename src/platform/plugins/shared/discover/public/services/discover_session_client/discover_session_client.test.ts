/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { httpServiceMock } from '@kbn/core/public/mocks';
import { SavedObjectNotFound } from '@kbn/kibana-utils-plugin/public';
import {
  DISCOVER_SESSION_API_BASE_PATH,
  DISCOVER_SESSION_API_VERSION,
} from '../../../common/constants';
import type { DiscoverSessionApiDataInput, DiscoverSessionApiResponse } from '../../../server';
import { createDiscoverSessionClient } from './discover_session_client';

const data: DiscoverSessionApiDataInput = {
  title: 'Session',
  tabs: [
    {
      id: 'main',
      label: 'Main',
      data_source: { type: 'esql', query: 'FROM logs-*' },
    },
  ],
};

const responseBody: DiscoverSessionApiResponse = {
  id: 'session-1',
  data: {
    title: 'Session',
    description: '',
    tabs: [
      {
        id: 'main',
        label: 'Main',
        sort: [],
        data_source: { type: 'esql', query: 'FROM logs-*' },
        hide_chart: false,
        hide_table: false,
        time_restore: false,
      },
    ],
  },
  meta: { managed: false },
};

describe('DiscoverSessionClient', () => {
  const http = httpServiceMock.createStartContract();
  const client = createDiscoverSessionClient(http);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('gets a session and exposes saved object resolve metadata', async () => {
    const headers = new Headers({
      'kbn-resolve-outcome': 'aliasMatch',
      'kbn-resolve-alias-target-id': 'session-1',
      'kbn-resolve-purpose': 'savedObjectConversion',
    });
    http.get.mockResolvedValue({
      body: responseBody,
      response: { headers } as Response,
    });

    await expect(client.get('legacy/session')).resolves.toEqual({
      ...responseBody,
      resolve: {
        outcome: 'aliasMatch',
        aliasTargetId: 'session-1',
        aliasPurpose: 'savedObjectConversion',
      },
    });

    expect(http.get).toHaveBeenCalledWith(
      `${DISCOVER_SESSION_API_BASE_PATH}/legacy%2Fsession`,
      {
        version: DISCOVER_SESSION_API_VERSION,
        asResponse: true,
      }
    );
  });

  it('maps a missing session to SavedObjectNotFound', async () => {
    const error = Object.assign(new Error('Not Found'), {
      request: {},
      response: { status: 404 },
    });
    http.get.mockRejectedValue(error);

    await expect(client.get('missing')).rejects.toBeInstanceOf(SavedObjectNotFound);
  });

  it('creates a session with the versioned API', async () => {
    http.post.mockResolvedValue(responseBody);

    await expect(client.create(data)).resolves.toBe(responseBody);

    expect(http.post).toHaveBeenCalledWith(DISCOVER_SESSION_API_BASE_PATH, {
      version: DISCOVER_SESSION_API_VERSION,
      body: JSON.stringify(data),
    });
  });

  it('upserts a session and encodes its id', async () => {
    http.put.mockResolvedValue(responseBody);

    await expect(client.upsert('session/1', data)).resolves.toBe(responseBody);

    expect(http.put).toHaveBeenCalledWith(`${DISCOVER_SESSION_API_BASE_PATH}/session%2F1`, {
      version: DISCOVER_SESSION_API_VERSION,
      body: JSON.stringify(data),
    });
  });
});
