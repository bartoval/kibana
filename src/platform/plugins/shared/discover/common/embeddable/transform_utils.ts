/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { DiscoverSessionTabAttributes } from '@kbn/saved-search-plugin/server';
import type { SavedSearchAttributes } from '@kbn/saved-search-plugin/common';
import { extractTabs, SavedSearchType } from '@kbn/saved-search-plugin/common';
import {
  extractReferences,
  injectReferences,
  parseSearchSourceJSON,
} from '@kbn/data-plugin/common';
import type { SavedObjectReference } from '@kbn/core/server';
import { DiscoverTabType } from '@kbn/discover-session-constants';
import {
  isDiscoverSessionEmbeddableByReferenceState,
  isDiscoverSessionEsqlTab,
  isSearchEmbeddableByValueState,
} from './type_guards';
import type {
  DiscoverSessionEmbeddableByReferenceState,
  DiscoverSessionEmbeddableByValueState,
  DiscoverSessionEmbeddableState,
  DiscoverSessionTab,
} from '../../server';
import type {
  SearchEmbeddableByReferenceState,
  SearchEmbeddableState,
  StoredSearchEmbeddableByReferenceState,
  StoredSearchEmbeddableByValueState,
  StoredSearchEmbeddableState,
} from './types';
import {
  DISCOVER_SESSION_EMBEDDABLE_SYNTHETIC_TAB_ID,
  DISCOVER_SESSION_EMBEDDABLE_SYNTHETIC_TAB_LABEL,
  SAVED_SEARCH_SAVED_OBJECT_REF_NAME,
} from './constants';
import {
  fromApiTabToSearchAndTableState,
  fromApiFieldsToTableState,
  fromSearchAndTableStateToApiFields,
  fromTableStateToApiFields,
} from '../session/search_and_table_mapping';
import {
  fromApiToStoredTabTypeState,
  fromStoredToApiTabTypeState,
} from '../session/tab_type_state';

export function fromStoredSearchEmbeddable(
  storedState: SearchEmbeddableState | StoredSearchEmbeddableState,
  references: SavedObjectReference[] = []
): DiscoverSessionEmbeddableState {
  return isSearchEmbeddableByValueState(storedState)
    ? fromStoredSearchEmbeddableByValue(storedState, [
        ...references,
        ...(storedState.attributes.references ?? []),
      ])
    : fromStoredSearchEmbeddableByRef(storedState, references);
}

export function toStoredSearchEmbeddable(
  apiState: DiscoverSessionEmbeddableState,
  references: SavedObjectReference[] = []
): { state: StoredSearchEmbeddableState; references: SavedObjectReference[] } {
  return isDiscoverSessionEmbeddableByReferenceState(apiState)
    ? toStoredSearchEmbeddableByRef(apiState, references)
    : toStoredSearchEmbeddableByValue(apiState, references);
}

export function fromStoredSearchEmbeddableByRef(
  storedState: SearchEmbeddableByReferenceState | StoredSearchEmbeddableByReferenceState,
  references: SavedObjectReference[] = []
): DiscoverSessionEmbeddableByReferenceState {
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
    selectedTabId,
    savedObjectId,
    ...otherAttrs
  } = {
    ...storedState,
    savedObjectId:
      references.find(
        (ref) => SavedSearchType === ref.type && ref.name === SAVED_SEARCH_SAVED_OBJECT_REF_NAME
      )?.id ??
      ('savedObjectId' in storedState && storedState.savedObjectId),
  };
  if (!savedObjectId) throw new Error(`Missing reference of type "${SavedSearchType}"`);
  return {
    ...otherAttrs,
    ref_id: savedObjectId,
    selected_tab_id: selectedTabId,
    overrides: fromTableStateToApiFields(storedState),
  };
}

export function toStoredSearchEmbeddableByRef(
  apiState: DiscoverSessionEmbeddableByReferenceState,
  references: SavedObjectReference[] = []
): { state: StoredSearchEmbeddableByReferenceState; references: SavedObjectReference[] } {
  const discoverSessionReference: SavedObjectReference = {
    name: SAVED_SEARCH_SAVED_OBJECT_REF_NAME,
    type: SavedSearchType,
    id: apiState.ref_id,
  };
  const { ref_id, selected_tab_id, overrides, ...otherAttrs } = apiState;
  const state: StoredSearchEmbeddableByReferenceState = {
    ...otherAttrs,
    ...fromApiFieldsToTableState(overrides ?? {}),
    ...(selected_tab_id != null && { selectedTabId: selected_tab_id }),
  };
  return {
    state,
    references: [...references, discoverSessionReference],
  };
}

export function fromStoredSearchEmbeddableByValue(
  storedState: StoredSearchEmbeddableByValueState,
  references: SavedObjectReference[] = []
): DiscoverSessionEmbeddableByValueState {
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
    attributes,
    title,
    description,
    ...otherAttrs
  } = storedState;
  const [tab] = attributes.tabs ?? extractTabs(attributes).tabs;
  const apiTab = fromStoredTab(tab.attributes, references);
  // Saved Metrics settings only apply to an ES|QL tab; a mismatch is dropped rather than failing
  // the panel, unlike the session API which rejects the session outright.
  const typedTab: DiscoverSessionEmbeddableByValueState['tabs'][number] =
    tab.attributes.tabTypeState && isDiscoverSessionEsqlTab(apiTab)
      ? { ...apiTab, ...fromStoredToApiTabTypeState(tab.attributes.tabTypeState) }
      : { ...apiTab, type: DiscoverTabType.Default };
  const panelOverrides = fromTableStateToApiFields(storedState);
  const { hide_title, hide_border } = storedState;

  return {
    ...otherAttrs,
    title: title || attributes.title,
    description: description || attributes.description,
    ...(hide_title && { hide_title }),
    ...(hide_border && { hide_border }),
    tabs: [{ ...typedTab, ...panelOverrides }],
  };
}

export function toStoredSearchEmbeddableByValue(
  apiState: DiscoverSessionEmbeddableByValueState,
  references: SavedObjectReference[] = []
): { state: StoredSearchEmbeddableByValueState; references: SavedObjectReference[] } {
  const {
    tabs: [apiTab],
    ...otherAttrs
  } = apiState;
  const { state: tabAttributes, references: tabReferences } = toStoredTab(apiTab);
  const tabTypeState = fromApiToStoredTabTypeState(apiTab);
  const state: StoredSearchEmbeddableByValueState = {
    ...otherAttrs,
    ...fromApiFieldsToTableState(apiTab),
    attributes: {
      ...tabAttributes,
      sort: tabAttributes.sort as SavedSearchAttributes['sort'],
      title: apiState.title ?? '',
      description: apiState.description ?? '',
      tabs: [
        {
          id: DISCOVER_SESSION_EMBEDDABLE_SYNTHETIC_TAB_ID,
          label: DISCOVER_SESSION_EMBEDDABLE_SYNTHETIC_TAB_LABEL,
          attributes: {
            ...tabAttributes,
            ...(tabTypeState !== undefined && { tabTypeState }),
          },
        },
      ],
    },
  };
  return {
    state,
    references: [...references, ...tabReferences],
  };
}

export function fromStoredTab(
  tab: DiscoverSessionTabAttributes,
  references: SavedObjectReference[] = []
): DiscoverSessionTab {
  const { searchSourceJSON } = tab.kibanaSavedObjectMeta;
  const searchSourceValues = parseSearchSourceJSON(searchSourceJSON);
  const searchSource = injectReferences(searchSourceValues, references);
  return fromSearchAndTableStateToApiFields(tab, searchSource);
}

export function toStoredTab(
  apiTab: DiscoverSessionTab,
  options?: { refNamePrefix?: string }
): {
  state: DiscoverSessionTabAttributes;
  references: SavedObjectReference[];
} {
  const { serializedSearchSource, ...tabFields } = fromApiTabToSearchAndTableState(apiTab);
  const [searchSourceFields, references] = extractReferences(serializedSearchSource, options);
  const state: DiscoverSessionTabAttributes = {
    ...tabFields,
    hideChart: false,
    hideTable: false,
    kibanaSavedObjectMeta: { searchSourceJSON: JSON.stringify(searchSourceFields) },
  };
  return { state, references };
}
