/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import React from 'react';
import { BehaviorSubject } from 'rxjs';
import { act, render, waitFor } from '@testing-library/react';
import { dataPluginMock, createSearchSourceMock } from '@kbn/data-plugin/public/mocks';
import { dataViewMock } from '@kbn/discover-utils/src/__mocks__';
import type { Filter } from '@kbn/es-query';
import type { SearchEmbeddableApi, SearchEmbeddableInputState } from '@kbn/discover-plugin/public';
import type { SavedSearch } from '@kbn/saved-search-plugin/common';
import type { SavedSearchComponentProps } from '../types';
import { SavedSearchComponent } from './saved_search';

type TestSearchEmbeddableApi = Pick<SearchEmbeddableApi, 'savedSearch$' | 'setColumns'>;

interface MockRendererProps {
  getParentApi: () => {
    getSerializedStateForChild: () => SearchEmbeddableInputState;
  };
  onApiAvailable?: (api: TestSearchEmbeddableApi) => void;
}

const mockUseEffect = React.useEffect;
let mockRendererProps: MockRendererProps | undefined;

jest.mock('@kbn/embeddable-plugin/public', () => ({
  EmbeddableRenderer: (props: MockRendererProps) => {
    mockUseEffect(() => {
      // Match EmbeddableRenderer, which captures these props for its async build on mount.
      mockRendererProps = props;
    }, []);
    return null;
  },
}));

const getMockRendererProps = (): MockRendererProps => {
  if (!mockRendererProps) {
    throw new Error('EmbeddableRenderer has not rendered');
  }
  return mockRendererProps;
};

const createFilter = (value: string): Filter => ({
  meta: {
    alias: null,
    disabled: false,
    negate: false,
  },
  query: { match_phrase: { 'service.name': value } },
});

const createProps = (nonHighlightingFilters?: Filter[]): { props: SavedSearchComponentProps } => {
  const data = dataPluginMock.createStartContract();
  const initialSearchSource = createSearchSourceMock();
  data.dataViews.create = jest.fn(async () => dataViewMock);
  data.search.searchSource.createEmpty = jest.fn(() => initialSearchSource);

  return {
    props: {
      dependencies: {
        embeddable: {} as SavedSearchComponentProps['dependencies']['embeddable'],
        dataViews: data.dataViews,
        searchSource: data.search.searchSource,
      },
      index: 'logs-*',
      query: { language: 'kuery', query: '' },
      filters: [],
      nonHighlightingFilters,
      columns: ['message'],
    },
  };
};

describe('SavedSearchComponent', () => {
  beforeEach(() => {
    mockRendererProps = undefined;
    jest.clearAllMocks();
  });

  it('provides declarative initial state to the embeddable', async () => {
    const { props } = createProps();
    render(<SavedSearchComponent {...props} />);

    await waitFor(() => expect(mockRendererProps).toBeDefined());

    const initialState = getMockRendererProps().getParentApi().getSerializedStateForChild();

    expect(initialState).toMatchObject({ tabs: [expect.any(Object)] });
    expect(initialState).not.toHaveProperty('attributes');
    expect(JSON.stringify(initialState)).not.toContain('searchSourceJSON');
  });

  it('applies the latest non-highlighting filters before the first fetch', async () => {
    const initialFilters = [createFilter('initial-service')];
    const latestFilters = [createFilter('latest-service')];
    const { props } = createProps(initialFilters);
    const component = render(<SavedSearchComponent {...props} />);

    await waitFor(() => expect(mockRendererProps).toBeDefined());

    component.rerender(<SavedSearchComponent {...props} nonHighlightingFilters={latestFilters} />);

    const runtimeSearchSource = createSearchSourceMock();
    const setFieldSpy = jest.spyOn(runtimeSearchSource, 'setField');
    const savedSearch: SavedSearch = {
      searchSource: runtimeSearchSource,
      managed: false,
    };
    const api: TestSearchEmbeddableApi = {
      savedSearch$: new BehaviorSubject(savedSearch),
      setColumns: jest.fn(),
    };
    const { onApiAvailable } = getMockRendererProps();

    if (!onApiAvailable) {
      throw new Error('EmbeddableRenderer did not receive onApiAvailable');
    }

    act(() => {
      onApiAvailable(api);
      expect(setFieldSpy).toHaveBeenCalledWith('nonHighlightingFilters', latestFilters);
      expect(setFieldSpy).not.toHaveBeenCalledWith('nonHighlightingFilters', initialFilters);
    });
  });
});
