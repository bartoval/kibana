/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { getMeta } from '@kbn/as-code-shared-schemas';
import type { RequestHandlerContext } from '@kbn/core/server';
import type { DiscoverSessionApiData, DiscoverSessionApiResponse } from './schema';
import { transformDiscoverSessionIn, transformDiscoverSessionOut } from './transforms';
import { assignStoredInlineDataViewIds } from './transforms/assign_stored_inline_data_view_ids';
import { upsertStoredDiscoverSession } from './stored_session';

export const upsertDiscoverSession = async (
  requestContext: RequestHandlerContext,
  id: string,
  data: DiscoverSessionApiData
): Promise<{
  body: DiscoverSessionApiResponse;
  operation: 'create' | 'update';
}> => {
  const { attributes, references } = transformDiscoverSessionIn(data);
  const { savedObject: updated, operation } = await upsertStoredDiscoverSession(
    requestContext,
    id,
    (existingAttributes) => ({
      attributes: assignStoredInlineDataViewIds(attributes, existingAttributes),
      references,
    })
  );

  return {
    body: {
      id: updated.id,
      data: transformDiscoverSessionOut(updated.attributes, updated.references).sessionState,
      meta: getMeta(updated),
    },
    operation,
  };
};
