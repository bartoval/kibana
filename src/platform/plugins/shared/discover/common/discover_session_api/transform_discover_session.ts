/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { AS_CODE_DATA_VIEW_SPEC_TYPE } from '@kbn/as-code-data-views-schema';
import type { SavedObjectsResolveResponse } from '@kbn/core/server';
import type {
  DiscoverSession,
  DiscoverSessionTab as StoredDiscoverSessionTab,
} from '@kbn/saved-search-plugin/common';
import type { DiscoverSessionTabAttributes } from '@kbn/saved-search-plugin/server';
import {
  fromDiscoverSessionPanelOverrides,
  fromStoredTab,
  isDiscoverSessionEsqlTab,
  toSerializedSearchSourceFields,
} from '../embeddable';
import type {
  DiscoverSessionApiData,
  DiscoverSessionApiResponse,
  DiscoverSessionApiTab,
} from '../../server';
import { transformControlPanelsIn, transformControlPanelsOut } from './transform_control_panels';
import {
  getVisContextRequestData,
  transformVisContextIn,
  transformVisContextOut,
} from './transform_vis_context';

export interface DiscoverSessionResolve {
  outcome: SavedObjectsResolveResponse['outcome'] | undefined;
  aliasTargetId: SavedObjectsResolveResponse['alias_target_id'];
  aliasPurpose: SavedObjectsResolveResponse['alias_purpose'];
}

export type DiscoverSessionSource = Pick<
  DiscoverSession,
  'title' | 'description' | 'tabs' | 'tags'
>;

const fromApiTab = (tab: DiscoverSessionApiTab): StoredDiscoverSessionTab => {
  const {
    sort = [],
    columns = [],
    grid = {},
    rowHeight,
    sampleSize,
    rowsPerPage,
    headerRowHeight,
    density,
    documentsDisplayMode,
    jsonModeSettings,
  } = fromDiscoverSessionPanelOverrides(tab);
  const isEsqlTab = isDiscoverSessionEsqlTab(tab);

  return {
    id: tab.id,
    label: tab.label,
    sort,
    columns,
    grid,
    hideChart: tab.hide_chart,
    hideTable: tab.hide_table,
    isTextBasedQuery: isEsqlTab,
    usesAdHocDataView: tab.data_source.type === AS_CODE_DATA_VIEW_SPEC_TYPE,
    serializedSearchSource: toSerializedSearchSourceFields(tab),
    ...(!isEsqlTab && { viewMode: tab.view_mode }),
    ...(tab.hide_aggregated_preview !== undefined && {
      hideAggregatedPreview: tab.hide_aggregated_preview,
    }),
    ...(rowHeight !== undefined && { rowHeight }),
    ...(headerRowHeight !== undefined && { headerRowHeight }),
    ...(isEsqlTab &&
      tab.esql_approximation !== undefined && { esqlApproximation: tab.esql_approximation }),
    timeRestore: tab.time_restore,
    ...(tab.time_range !== undefined && { timeRange: tab.time_range }),
    ...(tab.refresh_interval !== undefined && { refreshInterval: tab.refresh_interval }),
    ...(rowsPerPage !== undefined && { rowsPerPage }),
    ...(sampleSize !== undefined && { sampleSize }),
    ...(tab.breakdown_field !== undefined && { breakdownField: tab.breakdown_field }),
    ...(tab.chart_interval !== undefined && { chartInterval: tab.chart_interval }),
    ...(density !== undefined && { density }),
    ...(documentsDisplayMode !== undefined && { documentsDisplayMode }),
    ...(jsonModeSettings !== undefined && { jsonModeSettings }),
    ...(tab.vis_context !== undefined && {
      visContext: transformVisContextIn(tab.vis_context, getVisContextRequestData(tab)),
    }),
    ...(tab.control_panels !== undefined && {
      controlGroupJson: transformControlPanelsIn(tab.control_panels),
    }),
  };
};

const toApiTab = (tab: StoredDiscoverSessionTab): DiscoverSessionApiTab => {
  const { id, label, serializedSearchSource } = tab;
  const attributes: DiscoverSessionTabAttributes = {
    sort: tab.sort,
    columns: tab.columns,
    grid: tab.grid,
    hideChart: tab.hideChart,
    hideTable: tab.hideTable,
    isTextBasedQuery: tab.isTextBasedQuery,
    usesAdHocDataView: tab.usesAdHocDataView,
    kibanaSavedObjectMeta: { searchSourceJSON: JSON.stringify(serializedSearchSource) },
    viewMode: tab.viewMode,
    hideAggregatedPreview: tab.hideAggregatedPreview,
    rowHeight: tab.rowHeight,
    headerRowHeight: tab.headerRowHeight,
    esqlApproximation: tab.esqlApproximation,
    timeRestore: tab.timeRestore,
    timeRange: tab.timeRange,
    refreshInterval: tab.refreshInterval,
    rowsPerPage: tab.rowsPerPage,
    sampleSize: tab.sampleSize,
    breakdownField: tab.breakdownField,
    chartInterval: tab.chartInterval,
    density: tab.density,
    documentsDisplayMode: tab.documentsDisplayMode,
    jsonModeSettings: tab.jsonModeSettings,
    visContext: tab.visContext as DiscoverSessionTabAttributes['visContext'],
    controlGroupJson: tab.controlGroupJson,
  };
  const apiTab = fromStoredTab(attributes);
  const visContext = transformVisContextOut(tab.visContext);
  const { panels: controlPanels, warnings } = transformControlPanelsOut(
    tab.controlGroupJson,
    tab.id
  );

  if (warnings.length > 0) {
    throw new Error(warnings.map(({ message }) => message).join('; '));
  }

  return {
    id,
    label,
    ...apiTab,
    hide_chart: tab.hideChart,
    hide_table: tab.hideTable,
    ...(tab.hideAggregatedPreview !== undefined && {
      hide_aggregated_preview: tab.hideAggregatedPreview,
    }),
    ...(tab.breakdownField !== undefined && { breakdown_field: tab.breakdownField }),
    ...(tab.chartInterval !== undefined && { chart_interval: tab.chartInterval }),
    time_restore: tab.timeRestore ?? false,
    ...(tab.timeRange !== undefined && { time_range: tab.timeRange }),
    ...(tab.refreshInterval !== undefined && { refresh_interval: tab.refreshInterval }),
    ...(visContext !== undefined && { vis_context: visContext }),
    ...(controlPanels !== undefined && { control_panels: controlPanels }),
    ...(isDiscoverSessionEsqlTab(apiTab) &&
      tab.esqlApproximation !== undefined && { esql_approximation: tab.esqlApproximation }),
  } as DiscoverSessionApiTab;
};

export const fromDiscoverSessionApiResponse = (
  { id, data, meta }: DiscoverSessionApiResponse,
  resolve?: DiscoverSessionResolve
): DiscoverSession => ({
  id,
  title: data.title,
  description: data.description,
  tabs: data.tabs.map(fromApiTab),
  managed: Boolean(meta.managed),
  tags: data.tags,
  ...(resolve && { sharingSavedObjectProps: resolve }),
});

export const toDiscoverSessionApiData = ({
  title,
  description,
  tabs,
  tags,
}: DiscoverSessionSource): DiscoverSessionApiData => ({
  title,
  description,
  ...(tags !== undefined && { tags }),
  tabs: tabs.map(toApiTab),
});
