/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { AS_CODE_ESQL_DATA_SOURCE_TYPE } from '@kbn/as-code-data-views-schema';
import { fromStoredDataView, toStoredDataView } from '@kbn/as-code-data-views-transforms';
import { fromStoredFilters, toStoredFilters } from '@kbn/as-code-filters-transforms';
import { toAsCodeQuery, toStoredQuery } from '@kbn/as-code-shared-transforms';
import type { SerializedSearchSourceFields } from '@kbn/data-plugin/common';
import { isLegacySort, type SortOrder } from '@kbn/discover-utils';
import { isOfAggregateQueryType } from '@kbn/es-query';
import { VIEW_MODE } from '@kbn/saved-search-plugin/common';
import type { DiscoverSessionTab } from '@kbn/saved-search-plugin/common';
import type { DiscoverSessionTabAttributes } from '@kbn/saved-search-plugin/server';
import type { JsonModeSettings } from '@kbn/unified-data-table';
import type { DiscoverSessionPanelOverrides, DiscoverSessionTab as BaseApiTab } from '../../server';
import { isDiscoverSessionEsqlTab } from '../embeddable/type_guards';

/** Converts an API tab to search and table state, keeping its SearchSource as an object. */
export const fromApiTabToSearchAndTableState = (apiTab: BaseApiTab) => {
  const serializedSearchSource = fromApiTabToSearchSource(apiTab);
  const tableState = fromApiFieldsToTableState(apiTab);
  return {
    ...tableState,
    sort: tableState.sort ?? [],
    columns: tableState.columns ?? [],
    grid: tableState.grid ?? {},
    isTextBasedQuery: isDiscoverSessionEsqlTab(apiTab),
    serializedSearchSource,
    ...('view_mode' in apiTab && { viewMode: apiTab.view_mode }),
  };
};

/** Converts only an API tab's query, filters, and Data View, leaving references inline. */
export const fromApiTabToSearchSource = (apiTab: BaseApiTab): SerializedSearchSourceFields => {
  const query = isDiscoverSessionEsqlTab(apiTab)
    ? { esql: apiTab.data_source.query }
    : toStoredQuery(apiTab.query);
  return {
    ...(query && { query }),
    ...('filters' in apiTab && { filter: toStoredFilters(apiTab.filters) }),
    ...(!isDiscoverSessionEsqlTab(apiTab) && { index: toStoredDataView(apiTab.data_source) }),
  };
};

/** Converts search and table state to API fields without applying session-specific policies. */
export const fromSearchAndTableStateToApiFields = (
  tab: DiscoverSessionTab | DiscoverSessionTabAttributes,
  searchSource: SerializedSearchSourceFields
): BaseApiTab => {
  const { sort, sampleSize, rowsPerPage, viewMode } = tab;
  const apiTab = {
    ...fromTableStateToApiFields(tab),
    sort: fromStoredSort(sort),
  };
  const { index, query, filter } = searchSource;
  return isOfAggregateQueryType(query)
    ? {
        ...apiTab,
        data_source: {
          type: AS_CODE_ESQL_DATA_SOURCE_TYPE,
          query: query.esql,
        },
      }
    : {
        ...apiTab,
        ...(sampleSize && { sample_size: sampleSize }),
        ...(rowsPerPage && { rows_per_page: rowsPerPage }),
        ...(query && { query: toAsCodeQuery(query) }),
        filters: fromStoredFilters(filter) ?? [],
        data_source: fromStoredDataView(index),
        view_mode: viewMode ?? VIEW_MODE.DOCUMENT_LEVEL,
      };
};

/** Converts provided table settings to API fields without adding defaults. */
export function fromTableStateToApiFields(
  storedState: Partial<DiscoverSessionTabAttributes>
): DiscoverSessionPanelOverrides {
  const {
    sort,
    columns,
    rowHeight,
    sampleSize,
    rowsPerPage,
    headerRowHeight,
    density,
    documentsDisplayMode,
    jsonModeSettings,
    grid,
  } = storedState;
  return {
    ...(sort && { sort: fromStoredSort(sort) }),
    ...(columns && { column_order: columns }),
    ...(grid &&
      Object.keys(grid?.columns ?? {}).length && { column_settings: fromStoredGrid(grid) }),
    ...(rowHeight && { row_height: fromStoredRowHeight(rowHeight) }),
    ...(sampleSize && { sample_size: sampleSize }),
    ...(rowsPerPage && { rows_per_page: rowsPerPage }),
    ...(headerRowHeight && { header_row_height: fromStoredRowHeight(headerRowHeight) }),
    ...(density && { density }),
    ...(documentsDisplayMode && { documents_display_mode: documentsDisplayMode }),
    ...fromStoredJsonModeSettings(jsonModeSettings),
  };
}

/** Converts provided API table fields to stored settings without adding defaults. */
export function fromApiFieldsToTableState(apiState: DiscoverSessionPanelOverrides) {
  const {
    sort,
    column_order: columnOrder,
    column_settings: columnSettings,
    row_height: rowHeight,
    sample_size: sampleSize,
    rows_per_page: rowsPerPage,
    header_row_height: headerRowHeight,
    density,
    documents_display_mode: documentsDisplayMode,
  } = apiState;
  const jsonModeSettings = toStoredJsonModeSettings(apiState);
  return {
    ...(sort && { sort: toStoredSort(sort) }),
    ...(columnOrder && { columns: columnOrder }),
    ...(rowHeight && { rowHeight: toStoredHeight(rowHeight) }),
    ...(sampleSize && { sampleSize }),
    ...(rowsPerPage && { rowsPerPage }),
    ...(headerRowHeight && { headerRowHeight: toStoredHeight(headerRowHeight) }),
    ...(density && { density }),
    ...(documentsDisplayMode && { documentsDisplayMode }),
    ...(jsonModeSettings && { jsonModeSettings }),
    ...(Object.keys(columnSettings ?? {}).length && { grid: toStoredGrid(columnSettings) }),
  };
}

const fromStoredJsonModeSettings = (
  jsonModeSettings?: JsonModeSettings
): Pick<DiscoverSessionPanelOverrides, 'hide_nulls' | 'wrap_lines' | 'default_rendered_nodes'> => {
  if (!jsonModeSettings) {
    return {};
  }
  return {
    ...(jsonModeSettings.hideNulls !== undefined && { hide_nulls: jsonModeSettings.hideNulls }),
    ...(jsonModeSettings.wrapLines !== undefined && { wrap_lines: jsonModeSettings.wrapLines }),
    ...(jsonModeSettings.defaultRenderedNodes !== undefined && {
      default_rendered_nodes: jsonModeSettings.defaultRenderedNodes,
    }),
  };
};

const toStoredJsonModeSettings = (
  apiState: DiscoverSessionPanelOverrides
): JsonModeSettings | undefined => {
  const jsonModeSettings: JsonModeSettings = {
    ...(apiState.hide_nulls !== undefined && { hideNulls: apiState.hide_nulls }),
    ...(apiState.wrap_lines !== undefined && { wrapLines: apiState.wrap_lines }),
    ...(apiState.default_rendered_nodes !== undefined && {
      defaultRenderedNodes: apiState.default_rendered_nodes,
    }),
  };
  return Object.keys(jsonModeSettings).length > 0 ? jsonModeSettings : undefined;
};

export function fromStoredGrid(
  grid: DiscoverSessionTabAttributes['grid']
): BaseApiTab['column_settings'] {
  return grid.columns ?? {};
}

export function toStoredGrid(
  columnSettings: BaseApiTab['column_settings'] = {}
): DiscoverSessionTabAttributes['grid'] {
  return Object.keys(columnSettings).length > 0 ? { columns: columnSettings } : {};
}

export function fromStoredSort(sort: DiscoverSessionTabAttributes['sort']): BaseApiTab['sort'] {
  const sortInput = sort as SortOrder | SortOrder[];
  const normalizedSort: SortOrder[] = isLegacySort(sortInput) ? [sortInput] : sortInput;

  return normalizedSort.map((s) => {
    const [name, dir] = Array.isArray(s) ? s : [s, 'desc'];
    const direction = dir === 'asc' || dir === 'desc' ? dir : 'desc';
    return { name, direction };
  });
}

export function toStoredSort(
  sort: BaseApiTab['sort'] = []
): DiscoverSessionTabAttributes['sort'] & DiscoverSessionTab['sort'] {
  return sort.map((s) => [s.name, s.direction]);
}

export function fromStoredRowHeight(height: number) {
  return height === -1 ? 'auto' : height;
}

export function toStoredHeight(
  height: BaseApiTab['row_height'] | BaseApiTab['header_row_height']
): number {
  return typeof height === 'number' ? height : -1; // -1 === 'auto'
}
