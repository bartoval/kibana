/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { i18n } from '@kbn/i18n';
import type { UiActionsActionDefinition } from '@kbn/ui-actions-plugin/public';

export const DISCOVER_SELECTION_ACTION_TYPE = 'discover-selectionAction-type';
export const ACTION_APPLY_BRUSH_TIME_RANGE = 'discoverApplyBrushTimeRange';
export const ACTION_INVESTIGATE_BRUSH_SELECTION = 'discoverInvestigateBrushSelection';

export interface SelectionBrushContext {
  /**
   * Identifies the chart instance that fired the trigger. Several Discover tabs can have actions
   * registered at once, so each set only answers for its own instance.
   */
  instanceId: string;
  applySelection: () => void;
}

/**
 * The actions offered after a range is brushed on the histogram. Kibana shows them in a menu when
 * both are compatible, and runs the only compatible one directly otherwise.
 */
export const createSelectionBrushActions = ({
  instanceId,
  canInvestigate,
  onInvestigate,
}: {
  instanceId: string;
  canInvestigate: boolean;
  onInvestigate: () => void;
}): Array<UiActionsActionDefinition<SelectionBrushContext>> => {
  const belongsToThisInstance = async (context: SelectionBrushContext) =>
    context.instanceId === instanceId;

  return [
    {
      id: `${ACTION_APPLY_BRUSH_TIME_RANGE}-${instanceId}`,
      type: DISCOVER_SELECTION_ACTION_TYPE,
      order: 20,
      getIconType: () => 'calendar',
      getDisplayName: () =>
        i18n.translate('discover.investigateSelection.applyTimeRange', {
          defaultMessage: 'Apply time range',
        }),
      isCompatible: belongsToThisInstance,
      execute: async ({ applySelection }) => applySelection(),
    },
    {
      id: `${ACTION_INVESTIGATE_BRUSH_SELECTION}-${instanceId}`,
      type: DISCOVER_SELECTION_ACTION_TYPE,
      order: 10,
      getIconType: () => 'search',
      getDisplayName: () =>
        i18n.translate('discover.investigateSelection.actionLabel', {
          defaultMessage: 'Find what changed',
        }),
      isCompatible: async (context) => canInvestigate && (await belongsToThisInstance(context)),
      execute: async () => onInvestigate(),
    },
  ];
};
