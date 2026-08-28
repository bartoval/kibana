/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { DataGridDensity, UnifiedHistogramSuggestionType } from '@kbn/discover-utils';
import { VIEW_MODE } from '@kbn/saved-search-plugin/common';
import type { DiscoverSessionApiResponse } from '../../server';
import {
  fromDiscoverSessionApiResponse,
  toDiscoverSessionApiData,
} from './transform_discover_session';

const response: DiscoverSessionApiResponse = {
  id: 'session-1',
  data: {
    title: 'Round trip',
    description: 'Classic and ES|QL tabs',
    tags: ['tag-1'],
    tabs: [
      {
        id: 'classic',
        label: 'Classic',
        sort: [{ name: '@timestamp', direction: 'desc' }],
        column_order: ['message', '@timestamp'],
        column_settings: { message: { width: 320 } },
        row_height: 'auto',
        header_row_height: 2,
        rows_per_page: 50,
        sample_size: 500,
        density: DataGridDensity.COMPACT,
        documents_display_mode: 'json',
        json_mode_settings: { hide_nulls: true, wrap_lines: false },
        query: { language: 'kql', expression: 'status: 200' },
        filters: [
          {
            type: 'condition',
            data_view_id: 'logs-view',
            condition: { field: 'service.name', operator: 'is', value: 'checkout' },
          },
        ],
        data_source: { type: 'data_view_reference', ref_id: 'logs-view' },
        view_mode: VIEW_MODE.DOCUMENT_LEVEL,
        hide_chart: true,
        hide_table: false,
        hide_aggregated_preview: true,
        breakdown_field: 'service.name',
        chart_interval: 'h',
        time_restore: true,
        time_range: { from: 'now-24h', to: 'now' },
        refresh_interval: { pause: false, value: 30000 },
        vis_context: {
          suggestion_type: UnifiedHistogramSuggestionType.histogramForDataView,
          attributes: { visualizationType: 'lnsXY', state: { visualization: {} } },
        },
      },
      {
        id: 'adhoc',
        label: 'Ad hoc',
        sort: [],
        column_order: [],
        filters: [],
        data_source: {
          type: 'data_view_spec',
          name: 'Logs',
          index_pattern: 'logs-*',
          time_field: '@timestamp',
          allow_hidden_indices: false,
        },
        view_mode: VIEW_MODE.AGGREGATED_LEVEL,
        hide_chart: false,
        hide_table: false,
        time_restore: false,
      },
      {
        id: 'esql',
        label: 'ES|QL',
        sort: [{ name: 'count', direction: 'desc' }],
        column_order: ['service.name', 'count'],
        data_source: { type: 'esql', query: 'FROM logs-* | STATS count = COUNT(*) BY service.name' },
        hide_chart: false,
        hide_table: true,
        breakdown_field: 'service.name',
        time_restore: true,
        time_range: { from: 'now-1h', to: 'now' },
        refresh_interval: { pause: true, value: 60000 },
        esql_approximation: true,
        vis_context: {
          suggestion_type: UnifiedHistogramSuggestionType.histogramForESQL,
          attributes: {
            state: {
              datasourceStates: {
                textBased: { layers: { layer: { index: 'esql-data-view' } } },
              },
              adHocDataViews: {
                'esql-data-view': { type: 'esql', timeFieldName: '@timestamp' },
              },
            },
          },
        },
        control_panels: [
          {
            id: 'field-control',
            type: 'esql_control',
            width: 'medium',
            grow: false,
            config: {
              selected_options: ['service.name'],
              variable_name: 'field_name',
              single_select: true,
              variable_type: 'fields',
              control_type: 'STATIC_VALUES',
              available_options: ['service.name', 'host.name'],
              title: 'Field',
            },
          },
        ],
      },
    ],
  },
  meta: { managed: true, version: 'WzEsMV0=' },
};

describe('Discover session API adapters', () => {
  it('unpacks API defaults and resolve metadata into the internal session shape', () => {
    const session = fromDiscoverSessionApiResponse(response, {
      outcome: 'aliasMatch',
      aliasTargetId: 'session-1',
      aliasPurpose: 'savedObjectConversion',
    });

    expect(session).toMatchObject({
      id: 'session-1',
      title: 'Round trip',
      managed: true,
      tags: ['tag-1'],
      sharingSavedObjectProps: {
        outcome: 'aliasMatch',
        aliasTargetId: 'session-1',
        aliasPurpose: 'savedObjectConversion',
      },
    });
    expect(session.tabs[0]).toMatchObject({
      id: 'classic',
      columns: ['message', '@timestamp'],
      grid: { columns: { message: { width: 320 } } },
      rowHeight: -1,
      serializedSearchSource: {
        query: { language: 'kuery', query: 'status: 200' },
        index: 'logs-view',
      },
    });
    expect(session.tabs[1]).toMatchObject({
      id: 'adhoc',
      usesAdHocDataView: true,
      serializedSearchSource: {
        index: {
          title: 'logs-*',
          name: 'Logs',
          timeFieldName: '@timestamp',
          allowHidden: false,
        },
      },
    });
    expect(session.tabs[2]).toMatchObject({
      id: 'esql',
      isTextBasedQuery: true,
      esqlApproximation: true,
      serializedSearchSource: {
        query: { esql: 'FROM logs-* | STATS count = COUNT(*) BY service.name' },
      },
      visContext: {
        requestData: {
          dataViewId: 'esql-data-view',
          timeField: '@timestamp',
          breakdownField: 'service.name',
        },
      },
    });
  });

  it('round-trips classic, ad hoc, ES|QL, chart, filter, time, and control state', () => {
    const session = fromDiscoverSessionApiResponse(response);

    expect(toDiscoverSessionApiData(session)).toEqual(response.data);
  });

  it('fails instead of silently dropping invalid stored controls', () => {
    const session = fromDiscoverSessionApiResponse(response);
    session.tabs[2].controlGroupJson = '{invalid';

    expect(() => toDiscoverSessionApiData(session)).toThrow('controlGroupJson is not valid JSON');
  });
});
