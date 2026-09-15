/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { AS_CODE_DATA_VIEW_SPEC_TYPE } from '@kbn/as-code-data-views-schema';
import type {
  DiscoverSessionApiClassicTab,
  DiscoverSessionApiEsqlTab,
  DiscoverSessionApiTab,
} from '@kbn/as-code-discover-schema';
import type { SerializedSearchSourceFields } from '@kbn/data-plugin/common';
import { DiscoverTabType } from '@kbn/discover-session-constants';
import { isFilterPinned, unpinFilter } from '@kbn/es-query';
import type { DiscoverSessionTab } from '@kbn/saved-search-plugin/common';
import type { DiscoverSessionTabAttributes } from '@kbn/saved-search-plugin/server';
import type { DiscoverSessionTab as BaseApiTab } from '../../server';
import { isDiscoverSessionEsqlTab } from '../embeddable/type_guards';
import { fromSearchAndTableStateToApiFields } from './search_and_table_mapping';
import { fromStoredToApiTabTypeState } from './tab_type_state';

type TabWithoutTypeState =
  | Omit<DiscoverSessionApiClassicTab, 'type'>
  | Omit<DiscoverSessionApiEsqlTab, 'type'>;

/** Maps API display, time, and query settings to tab fields, including inline Data View usage. */
export const fromApiTabToSessionFields = (tab: DiscoverSessionApiTab) => ({
  hideChart: tab.hide_chart,
  hideTable: tab.hide_table,
  hideAggregatedPreview: tab.hide_aggregated_preview,
  breakdownField: tab.breakdown_field,
  chartInterval: tab.chart_interval,
  timeRestore: tab.time_range !== undefined,
  timeRange: tab.time_range,
  refreshInterval: tab.refresh_interval,
  usesAdHocDataView: tab.data_source.type === AS_CODE_DATA_VIEW_SPEC_TYPE,
  ...('esql_approximation' in tab &&
    tab.esql_approximation !== undefined && { esqlApproximation: tab.esql_approximation }),
});

/** Maps session display, time, and query settings to API fields. */
export const fromSessionTabToApiFields = (
  tab: Omit<DiscoverSessionTabAttributes, 'kibanaSavedObjectMeta'>
) => ({
  hide_chart: tab.hideChart ?? false,
  hide_table: tab.hideTable ?? false,
  ...(tab.hideAggregatedPreview !== undefined && {
    hide_aggregated_preview: tab.hideAggregatedPreview,
  }),
  ...(tab.breakdownField !== undefined && {
    breakdown_field: tab.breakdownField,
  }),
  ...(tab.chartInterval !== undefined && {
    chart_interval: tab.chartInterval as NonNullable<DiscoverSessionApiTab['chart_interval']>,
  }),
  ...(tab.timeRestore && tab.timeRange !== undefined && { time_range: tab.timeRange }),
  ...(tab.refreshInterval !== undefined && {
    refresh_interval: tab.refreshInterval,
  }),
  ...(tab.isTextBasedQuery &&
    tab.esqlApproximation !== undefined && {
      esql_approximation: tab.esqlApproximation,
    }),
});

/** Adds saved type settings to an API tab, rejecting Metrics settings on a non-ES|QL tab. */
export const applyTabTypeStateToApiTab = (
  apiTab: TabWithoutTypeState,
  tabTypeState: DiscoverSessionTabAttributes['tabTypeState']
): DiscoverSessionApiTab => {
  const apiTabTypeState = fromStoredToApiTabTypeState(tabTypeState);

  if (apiTabTypeState.type === DiscoverTabType.Default) {
    return { ...apiTab, ...apiTabTypeState };
  }

  if (!isDiscoverSessionEsqlTab(apiTab)) {
    throw new Error(
      `Metrics tab "${apiTab.label}" with ID "${apiTab.id}" requires an ES|QL data source.`
    );
  }

  return { ...apiTab, ...apiTabTypeState };
};

/** Maps session search and table state to API fields, keeping pinned conditions and omitting inline IDs. */
export const fromSearchAndTableStateToApiFieldsWithSessionPolicies = (
  tab: DiscoverSessionTab | DiscoverSessionTabAttributes,
  searchSource: SerializedSearchSourceFields
) => {
  const transformedTab = fromSearchAndTableStateToApiFields(
    tab,
    pinnedFiltersToAppFilters(searchSource)
  );
  const { index } = searchSource;
  const inlineDataViewId = index && typeof index !== 'string' ? index.id : undefined;
  return omitInlineDataViewIdFromFilters(transformedTab, inlineDataViewId);
};

const pinnedFiltersToAppFilters = (searchSource: SerializedSearchSourceFields) => {
  const { filter: filters } = searchSource;

  if (!Array.isArray(filters) || !filters.some(isFilterPinned)) {
    return searchSource;
  }

  return {
    ...searchSource,
    filter: filters.map(unpinFilter),
  };
};

const omitInlineDataViewIdFromFilters = (
  tab: BaseApiTab,
  inlineDataViewId: string | undefined
): BaseApiTab => {
  if (inlineDataViewId === undefined || isDiscoverSessionEsqlTab(tab)) {
    return tab;
  }

  const filters = tab.filters.map((filter) => {
    if (filter.data_view_id !== inlineDataViewId) {
      return filter;
    }

    const { data_view_id: _inlineDataViewId, ...filterWithoutDataViewId } = filter;
    return filterWithoutDataViewId;
  });

  return { ...tab, filters };
};
