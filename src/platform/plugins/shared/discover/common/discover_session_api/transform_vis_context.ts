/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import {
  AS_CODE_DATA_VIEW_SPEC_TYPE,
  AS_CODE_ESQL_DATA_SOURCE_TYPE,
} from '@kbn/as-code-data-views-schema';
import { ESQL_TYPE } from '@kbn/data-view-utils';
import { UnifiedHistogramSuggestionType } from '@kbn/discover-utils';
import { get } from 'lodash';
import type { DiscoverSessionTab as StoredDiscoverSessionTab } from '@kbn/saved-search-plugin/common';
import type { DiscoverSessionTabAttributes } from '@kbn/saved-search-plugin/server';
import type { DiscoverSessionApiTab } from '../../server';

type StoredVisContext = DiscoverSessionTabAttributes['visContext'];
type StoredVisContextInput = StoredDiscoverSessionTab['visContext'];
type ApiVisContext = DiscoverSessionApiTab['vis_context'];
type ApiSuggestionType = NonNullable<ApiVisContext>['suggestion_type'];

export interface StoredVisContextRequestData {
  dataViewId?: string;
  timeField?: string;
  timeInterval?: string;
  breakdownField?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isApiSuggestionType = (value: unknown): value is ApiSuggestionType =>
  value === UnifiedHistogramSuggestionType.lensSuggestion ||
  value === UnifiedHistogramSuggestionType.histogramForESQL ||
  value === UnifiedHistogramSuggestionType.histogramForDataView;

const extractEsqlFingerprint = (
  attributes: Record<string, unknown>
): { dataViewId: string; timeField?: string } | undefined => {
  const layers = get(attributes, 'state.datasourceStates.textBased.layers');
  if (!isRecord(layers)) {
    return undefined;
  }

  const layerIndexes = new Set<string>();

  for (const layer of Object.values(layers)) {
    if (isRecord(layer) && typeof layer.index === 'string' && layer.index.length > 0) {
      layerIndexes.add(layer.index);
    }
  }

  if (layerIndexes.size !== 1) {
    return undefined;
  }

  const [dataViewId] = layerIndexes;
  const adHocDataViews = get(attributes, 'state.adHocDataViews');

  if (!isRecord(adHocDataViews)) {
    return undefined;
  }

  const lensDataViewSpec = adHocDataViews[dataViewId];
  if (!isRecord(lensDataViewSpec) || lensDataViewSpec.type !== ESQL_TYPE) {
    return undefined;
  }

  return {
    dataViewId,
    ...(typeof lensDataViewSpec.timeFieldName === 'string' &&
      lensDataViewSpec.timeFieldName !== '' && { timeField: lensDataViewSpec.timeFieldName }),
  };
};

export const getVisContextRequestData = (
  tab: DiscoverSessionApiTab
): StoredVisContextRequestData => {
  const esqlFingerprint = tab.vis_context
    ? extractEsqlFingerprint(tab.vis_context.attributes)
    : undefined;

  if (esqlFingerprint) {
    return {
      dataViewId: esqlFingerprint.dataViewId,
      ...(esqlFingerprint.timeField !== undefined && { timeField: esqlFingerprint.timeField }),
      ...(tab.breakdown_field !== undefined &&
        tab.breakdown_field !== '' && { breakdownField: tab.breakdown_field }),
    };
  }

  const dataViewId =
    tab.data_source.type !== AS_CODE_DATA_VIEW_SPEC_TYPE && 'ref_id' in tab.data_source
      ? tab.data_source.ref_id
      : undefined;
  const timeField =
    tab.data_source.type === AS_CODE_DATA_VIEW_SPEC_TYPE && 'time_field' in tab.data_source
      ? tab.data_source.time_field
      : undefined;

  return {
    ...(dataViewId !== undefined && { dataViewId }),
    ...(timeField !== undefined && { timeField }),
    ...(tab.data_source.type !== AS_CODE_ESQL_DATA_SOURCE_TYPE &&
      tab.chart_interval !== undefined && { timeInterval: tab.chart_interval }),
    ...(tab.breakdown_field !== undefined &&
      tab.breakdown_field !== '' && { breakdownField: tab.breakdown_field }),
  };
};

export const transformVisContextOut = (
  visContext: StoredVisContextInput
): ApiVisContext | undefined => {
  if (
    !visContext ||
    !('suggestionType' in visContext) ||
    !('attributes' in visContext) ||
    !visContext.suggestionType ||
    !isRecord(visContext.attributes) ||
    !isApiSuggestionType(visContext.suggestionType)
  ) {
    return undefined;
  }

  return {
    suggestion_type: visContext.suggestionType,
    attributes: visContext.attributes,
  };
};

export const transformVisContextIn = (
  visContext: ApiVisContext,
  requestData: StoredVisContextRequestData = {}
): StoredVisContext => {
  if (!visContext) {
    return undefined;
  }

  return {
    suggestionType: visContext.suggestion_type,
    requestData,
    attributes: visContext.attributes,
  };
};
