/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import {
  apiTest,
  tags,
  type ApiClientFixture,
  type KbnClient,
  type RoleApiCredentials,
} from '@kbn/scout';
import { expect } from '@kbn/scout/api';
import { DASHBOARD_API_PATH, DASHBOARD_API_VERSION } from '@kbn/scout/constants';
import { BASE_HEADERS } from '../fixtures/constants';

const DASHBOARD_HEADERS = {
  ...BASE_HEADERS,
  'elastic-api-version': DASHBOARD_API_VERSION,
} as const;

const ESQL_QUERY = 'FROM logs-* | STATS count = COUNT(*) BY host.name';

const storedEsqlTab = (overrides: Record<string, unknown> = {}) => ({
  sort: [],
  columns: ['host.name'],
  grid: {},
  hideChart: false,
  hideTable: false,
  isTextBasedQuery: true,
  kibanaSavedObjectMeta: {
    searchSourceJSON: JSON.stringify({ query: { esql: ESQL_QUERY } }),
  },
  ...overrides,
});

const storedDashboardAttributes = (tabAttributes: Record<string, unknown>) => ({
  title: `Stored Discover panel ${Date.now()} ${Math.random()}`,
  description: '',
  optionsJSON: JSON.stringify({ useMargins: true, hidePanelTitles: false }),
  timeRestore: false,
  kibanaSavedObjectMeta: {
    searchSourceJSON: JSON.stringify({ query: { query: '', language: 'kuery' } }),
  },
  panelsJSON: JSON.stringify([
    {
      type: 'discover_session',
      panelIndex: 'stored-discover-panel',
      gridData: { x: 0, y: 0, w: 24, h: 15, i: 'stored-discover-panel' },
      embeddableConfig: {
        title: 'Stored Discover panel',
        attributes: {
          title: 'Stored Discover panel',
          description: '',
          ...tabAttributes,
          tabs: [{ id: 'stored-tab', label: 'Stored tab', attributes: tabAttributes }],
        },
      },
    },
  ]),
});

interface DashboardResponseBody {
  data: {
    panels: Array<{
      type: string;
      config: { tabs: Array<Record<string, unknown>> };
    }>;
  };
  warnings?: unknown;
}

apiTest.describe(
  'dashboards - stored Discover panel state',
  { tag: tags.deploymentAgnostic },
  () => {
    let editorCredentials: RoleApiCredentials;

    apiTest.beforeAll(async ({ requestAuth }) => {
      editorCredentials = await requestAuth.getApiKeyForPrivilegedUser();
    });

    apiTest.afterAll(async ({ kbnClient }) => {
      await kbnClient.savedObjects.clean({ types: ['dashboard'] });
    });

    const readDashboard = async (apiClient: ApiClientFixture, id: string) => {
      const response = await apiClient.get(`${DASHBOARD_API_PATH}/${id}`, {
        headers: {
          ...DASHBOARD_HEADERS,
          ...editorCredentials.apiKeyHeader,
        },
        responseType: 'json',
      });

      expect(response).toHaveStatusCode(200);
      return response;
    };

    const updateDashboard = async (
      apiClient: ApiClientFixture,
      id: string,
      data: DashboardResponseBody['data']
    ) => {
      const response = await apiClient.put(`${DASHBOARD_API_PATH}/${id}`, {
        headers: {
          ...DASHBOARD_HEADERS,
          ...editorCredentials.apiKeyHeader,
        },
        body: data,
        responseType: 'json',
      });

      expect(response).toHaveStatusCode(200);
    };

    const seedAndRead = async (
      apiClient: ApiClientFixture,
      kbnClient: KbnClient,
      tabAttributes: Record<string, unknown>
    ) => {
      const { id } = await kbnClient.savedObjects.create({
        type: 'dashboard',
        attributes: storedDashboardAttributes(tabAttributes),
        overwrite: true,
      });

      return { id, response: await readDashboard(apiClient, id) };
    };

    const getOnlyDiscoverTab = (response: { body: DashboardResponseBody }) => {
      expect(response.body.data.panels).toHaveLength(1);
      expect(response.body.data.panels[0].type).toBe('discover_session');
      expect(response.body.data.panels[0].config.tabs).toHaveLength(1);
      return response.body.data.panels[0].config.tabs[0];
    };

    const oversizedColumns = Array.from({ length: 101 }, (_, index) => `field_${index}`);
    const oversizedSort = Array.from(
      { length: 101 },
      (_, index) => [`field_${index}`, 'desc'] as const
    );
    const storedDataTableState = {
      sampleSize: 5,
      columns: oversizedColumns,
      sort: oversizedSort,
    };
    const apiDataTableState = {
      sample_size: 5,
      column_order: oversizedColumns,
      sort: oversizedSort.map(([name, direction]) => ({ name, direction })),
    };

    apiTest(
      'preserves storage-compatible data table values through Dashboard GET and PUT',
      async ({ apiClient, kbnClient }) => {
        const { id, response: initialResponse } = await seedAndRead(
          apiClient,
          kbnClient,
          storedEsqlTab(storedDataTableState)
        );

        expect(getOnlyDiscoverTab(initialResponse)).toMatchObject(apiDataTableState);
        expect(initialResponse.body.warnings).toBeUndefined();

        await updateDashboard(apiClient, id, initialResponse.body.data);

        const savedResponse = await readDashboard(apiClient, id);
        expect(getOnlyDiscoverTab(savedResponse)).toMatchObject(apiDataTableState);
        expect(savedResponse.body.warnings).toBeUndefined();
      }
    );
  }
);
