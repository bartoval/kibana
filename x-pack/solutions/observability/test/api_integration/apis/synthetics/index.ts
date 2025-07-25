/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { FtrProviderContext } from '../../ftr_provider_context';

export default function ({ getService, loadTestFile }: FtrProviderContext) {
  const esDeleteAllIndices = getService('esDeleteAllIndices');

  // temporary workaround for registry promotion
  describe.skip('Synthetics API Tests', () => {
    before(async () => {
      await esDeleteAllIndices('heartbeat*');
      await esDeleteAllIndices('synthetics*');
    });

    loadTestFile(require.resolve('./synthetics_api_security'));
    loadTestFile(require.resolve('./synthetics_enablement'));
    loadTestFile(require.resolve('./add_monitor'));
    loadTestFile(require.resolve('./add_monitor_project'));
    loadTestFile(require.resolve('./add_monitor_private_location'));
    loadTestFile(require.resolve('./edit_monitor'));
    loadTestFile(require.resolve('./sync_global_params'));
    loadTestFile(require.resolve('./add_edit_params'));
    loadTestFile(require.resolve('./private_location_apis'));
    loadTestFile(require.resolve('./list_monitors'));
  });
}
