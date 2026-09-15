/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { toAsCodeTags } from '@kbn/as-code-shared-transforms';
import type { SavedObjectReference } from '@kbn/core/server';
import type { DiscoverSessionAttributes } from '@kbn/saved-search-plugin/server';
import { injectReferences, parseSearchSourceJSON } from '@kbn/data-plugin/common';
import type { DiscoverSessionApiData, DiscoverSessionWarning } from '../schema';
import { transformControlPanelsOut } from './transform_control_panels';
import {
  applyTabTypeStateToApiTab,
  fromSearchAndTableStateToApiFieldsWithSessionPolicies,
  fromSessionTabToApiFields,
} from '../../../common/session/session_tab_mapping';
import { toApiVisContext } from '../../../common/session/vis_context';

/** Builds API session data, preserving valid controls and collecting warnings for omitted ones. */
export const transformDiscoverSessionOut = (
  attributes: DiscoverSessionAttributes,
  references: SavedObjectReference[] = []
): { sessionState: DiscoverSessionApiData; warnings: DiscoverSessionWarning[] } => {
  const { tags } = toAsCodeTags(references);
  const warnings: DiscoverSessionWarning[] = [];
  const sessionState: DiscoverSessionApiData = {
    title: attributes.title,
    description: attributes.description,
    tags,
    tabs: attributes.tabs.map((tab) => {
      const searchSource = injectReferences(
        parseSearchSourceJSON(tab.attributes.kibanaSavedObjectMeta.searchSourceJSON),
        references
      );
      const apiTab = {
        ...fromSearchAndTableStateToApiFieldsWithSessionPolicies(tab.attributes, searchSource),
        ...fromSessionTabToApiFields(tab.attributes),
      };
      const visContext = toApiVisContext(tab.attributes.visContext);
      const { panels: controlPanels, warnings: controlPanelWarnings } = transformControlPanelsOut(
        tab.attributes.controlGroupJson,
        tab.id
      );
      warnings.push(...controlPanelWarnings);

      const sessionTab = {
        id: tab.id,
        label: tab.label,
        ...apiTab,
        ...(visContext !== undefined && { vis_context: visContext }),
        ...(controlPanels !== undefined && { control_panels: controlPanels }),
      };

      return applyTabTypeStateToApiTab(sessionTab, tab.attributes.tabTypeState);
    }),
  };

  return { sessionState, warnings };
};
