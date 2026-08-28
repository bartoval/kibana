/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import {
  transformControlPanelsIn as transformControlPanelsInCommon,
  transformControlPanelsOut as transformControlPanelsOutCommon,
} from '../../../common/discover_session_api/transform_control_panels';
import type { DiscoverSessionControlPanels, DiscoverSessionWarning } from '../schema';
import { discoverSessionControlPanelSchema, discoverSessionControlPanelsSchema } from '../schema';

export const transformControlPanelsOut = (
  controlGroupJson: string | undefined,
  tabId: string
): { panels: DiscoverSessionControlPanels | undefined; warnings: DiscoverSessionWarning[] } =>
  transformControlPanelsOutCommon(controlGroupJson, tabId, {
    parseControlPanel: (controlPanel) => discoverSessionControlPanelSchema.parse(controlPanel),
    parseControlPanels: (controlPanels) => discoverSessionControlPanelsSchema.parse(controlPanels),
  });

export const transformControlPanelsIn = transformControlPanelsInCommon;
