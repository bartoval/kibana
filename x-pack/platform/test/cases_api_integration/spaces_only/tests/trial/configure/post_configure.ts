/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type http from 'http';
import expect from '@kbn/expect';
import type { ConnectorTypes } from '@kbn/cases-plugin/common/types/domain';
import { ObjectRemover as ActionsRemover } from '../../../../../alerting_api_integration/common/lib';
import type { FtrProviderContext } from '../../../../common/ftr_provider_context';

import {
  getConfigurationRequest,
  removeServerGeneratedPropertiesFromSavedObject,
  getConfigurationOutput,
  deleteConfiguration,
  createConfiguration,
  getAuthWithSuperUser,
  getActionsSpace,
  getServiceNowConnector,
  createConnector,
  getServiceNowSimulationServer,
} from '../../../../common/lib/api';
import { nullUser } from '../../../../common/lib/mock';

export default ({ getService }: FtrProviderContext): void => {
  const supertest = getService('supertest');
  const supertestWithoutAuth = getService('supertestWithoutAuth');
  const es = getService('es');
  const authSpace1 = getAuthWithSuperUser();
  const space = getActionsSpace(authSpace1.space);

  describe('post_configure', () => {
    const actionsRemover = new ActionsRemover(supertest);
    let serviceNowSimulatorURL: string = '';
    let serviceNowServer: http.Server;

    before(async () => {
      const { server, url } = await getServiceNowSimulationServer();
      serviceNowServer = server;
      serviceNowSimulatorURL = url;
    });

    afterEach(async () => {
      await deleteConfiguration(es);
      await actionsRemover.removeAll();
    });

    after(async () => {
      serviceNowServer.close();
    });

    it('should create a configuration with a mapping in space1', async () => {
      const connector = await createConnector({
        supertest: supertestWithoutAuth,
        req: {
          ...getServiceNowConnector(),
          config: { apiUrl: serviceNowSimulatorURL },
        },
        auth: authSpace1,
      });

      actionsRemover.add(space, connector.id, 'connector', 'actions');

      const postRes = await createConfiguration(
        supertestWithoutAuth,
        getConfigurationRequest({
          id: connector.id,
          name: connector.name,
          type: connector.connector_type_id as ConnectorTypes,
        }),
        200,
        authSpace1
      );

      const data = removeServerGeneratedPropertiesFromSavedObject(postRes);
      expect(data).to.eql(
        getConfigurationOutput(false, {
          created_by: nullUser,
          mappings: [
            {
              action_type: 'overwrite',
              source: 'title',
              target: 'short_description',
            },
            {
              action_type: 'overwrite',
              source: 'description',
              target: 'description',
            },
            {
              action_type: 'append',
              source: 'comments',
              target: 'work_notes',
            },
          ],
          connector: {
            id: connector.id,
            name: connector.name,
            type: connector.connector_type_id,
            fields: null,
          },
        })
      );
    });
  });
};
