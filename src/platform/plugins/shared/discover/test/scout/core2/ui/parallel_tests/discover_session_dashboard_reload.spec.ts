/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { expect } from '@kbn/scout/ui';
import { spaceTest, tags, testData } from '../fixtures';

const STORED_PANEL_ID = 'stored-discover-panel';
const STORED_PANEL_TITLE = 'Stored Discover chart state';
const UNSAVED_CHANGES_NOTIFICATION = 'split-button-notification-indicator';
const STORED_CHART_STATE = {
  hideChart: true,
  breakdownField: 'host.name',
};

const storedTabAttributes = {
  sort: [],
  columns: ['host.name'],
  grid: {},
  hideTable: false,
  isTextBasedQuery: true,
  kibanaSavedObjectMeta: {
    searchSourceJSON: JSON.stringify({
      query: { esql: 'FROM logstash-* | LIMIT 10' },
    }),
  },
  ...STORED_CHART_STATE,
};

const createStoredDashboardAttributes = () => ({
  title: `Dashboard preserving Discover state ${Date.now()}`,
  description: '',
  optionsJSON: JSON.stringify({
    useMargins: true,
    hidePanelTitles: false,
    syncColors: false,
  }),
  timeRestore: false,
  kibanaSavedObjectMeta: {
    searchSourceJSON: JSON.stringify({ query: { query: '', language: 'kuery' } }),
  },
  panelsJSON: JSON.stringify([
    {
      type: 'discover_session',
      panelIndex: STORED_PANEL_ID,
      gridData: { x: 0, y: 0, w: 24, h: 15, i: STORED_PANEL_ID },
      embeddableConfig: {
        title: STORED_PANEL_TITLE,
        attributes: {
          title: STORED_PANEL_TITLE,
          description: '',
          ...storedTabAttributes,
          tabs: [
            {
              id: 'stored-tab',
              label: 'Stored tab',
              attributes: storedTabAttributes,
            },
          ],
        },
      },
    },
  ]),
});

interface StoredDashboardResponse {
  attributes: {
    panelsJSON: string;
  };
}

interface StoredDiscoverPanel {
  panelIndex: string;
  embeddableConfig: {
    attributes: {
      tabs: Array<{ attributes: Record<string, unknown> }>;
    };
  };
}

spaceTest.describe(
  'Discover session panels on Dashboard',
  { tag: [...tags.deploymentAgnostic, ...tags.serverless.observability.logs_essentials] },
  () => {
    spaceTest.beforeAll(async ({ discoverScoutSpace }) => {
      await discoverScoutSpace.setupDiscoverDefaults();
    });

    spaceTest.beforeEach(async ({ browserAuth }) => {
      await browserAuth.loginAsPrivilegedUser();
    });

    spaceTest.afterAll(async ({ discoverScoutSpace }) => {
      await discoverScoutSpace.teardownDiscoverDefaults();
    });

    spaceTest(
      'renders linked and by-value panels after saving and reload',
      async ({ page, pageObjects, scoutSpace }) => {
        const { dashboard } = pageObjects;

        const clonedPanelTitle = await spaceTest.step(
          'add a linked Discover session and create a by-value clone',
          async () => {
            await dashboard.openNewDashboard();
            await dashboard.addSavedSearch(testData.SAVED_SEARCH_TITLE);
            await dashboard.waitForRenderComplete();
            await dashboard.expectLinkedToLibrary(testData.SAVED_SEARCH_TITLE);

            await dashboard.clonePanel(testData.SAVED_SEARCH_TITLE);
            await dashboard.waitForRenderComplete();

            const panelTitles = await dashboard.getPanelTitles();
            const clonedPanelTitles = panelTitles.filter(
              (title) => title !== testData.SAVED_SEARCH_TITLE
            );

            expect(panelTitles).toHaveLength(2);
            expect(clonedPanelTitles).toHaveLength(1);
            return clonedPanelTitles[0];
          }
        );

        await spaceTest.step('save and reload the dashboard', async () => {
          await dashboard.saveDashboard(`Discover session panels reload ${scoutSpace.id}`);
          await page.reload();
          await dashboard.waitForPanelsToLoad(2);
        });

        await spaceTest.step('verify both Discover panels and their reference state', async () => {
          expect(await dashboard.getPanelCount()).toBe(2);
          const discoverPanels = page.testSubj.locator('embeddablePanel').filter({
            has: page.testSubj.locator('discoverDocTable'),
          });

          await expect(discoverPanels).toHaveCount(2);
          await expect(page.testSubj.locator('embeddableError')).toHaveCount(0);
          await expect.poll(() => dashboard.getSavedSearchRowCount()).toBeGreaterThan(0);

          await dashboard.expectLinkedToLibrary(testData.SAVED_SEARCH_TITLE);
          await dashboard.expectNotLinkedToLibrary(clonedPanelTitle);
          await expect(page.testSubj.locator(UNSAVED_CHANGES_NOTIFICATION)).toBeHidden();
        });
      }
    );

    spaceTest(
      'preserves stored by-value chart state when saving unrelated dashboard changes',
      async ({ apiServices, kbnClient, page, pageObjects, scoutSpace }) => {
        const createdDashboard = await apiServices.savedObjects.create({
          type: 'dashboard',
          spaceId: scoutSpace.id,
          attributes: createStoredDashboardAttributes(),
        });
        const dashboardId = createdDashboard.data.id;
        const readStoredTab = async () => {
          const response = await kbnClient.request<StoredDashboardResponse>({
            method: 'GET',
            path: `/s/${encodeURIComponent(
              scoutSpace.id
            )}/api/saved_objects/dashboard/${encodeURIComponent(dashboardId)}`,
          });
          const panels = JSON.parse(response.data.attributes.panelsJSON) as StoredDiscoverPanel[];
          return panels.find(({ panelIndex }) => panelIndex === STORED_PANEL_ID)?.embeddableConfig
            .attributes.tabs[0]?.attributes;
        };

        await spaceTest.step('verify the seeded chart state', async () => {
          expect(await readStoredTab()).toMatchObject(STORED_CHART_STATE);
        });

        await spaceTest.step('load without reporting unsaved changes', async () => {
          await pageObjects.dashboard.openDashboardWithIdInEditMode(dashboardId);
          await pageObjects.dashboard.waitForRenderComplete();
          await expect(page.testSubj.locator(UNSAVED_CHANGES_NOTIFICATION)).toBeHidden();
        });

        await spaceTest.step('save an unrelated dashboard setting', async () => {
          await pageObjects.dashboard.openSettingsFlyout();
          await pageObjects.dashboard.toggleSyncColors(true);
          await pageObjects.dashboard.applyDashboardSettings();
          await expect(page.testSubj.locator(UNSAVED_CHANGES_NOTIFICATION)).toBeVisible();

          await pageObjects.dashboard.saveChangesToExistingDashboard();
          await expect(page.testSubj.locator(UNSAVED_CHANGES_NOTIFICATION)).toBeHidden();
        });

        await spaceTest.step('keep the stored chart state intact', async () => {
          expect(await readStoredTab()).toMatchObject(STORED_CHART_STATE);
        });
      }
    );
  }
);
