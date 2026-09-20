/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { asCodeIdSchema } from '@kbn/as-code-shared-schemas';
import type { RequestHandlerContext, SavedObject } from '@kbn/core/server';
import { isSavedObjectErrorResult, SavedObjectsErrorHelpers } from '@kbn/core/server';
import { SavedSearchType } from '@kbn/saved-search-plugin/common';
import type { StoredDiscoverSession } from '@kbn/saved-search-plugin/common';
import type { DiscoverSessionAttributes } from '@kbn/saved-search-plugin/server';

type StoredSession = SavedObject<DiscoverSessionAttributes>;

/** Creates a session from its serialized attributes and references. */
export const createStoredDiscoverSession = async (
  context: RequestHandlerContext,
  { attributes, references }: StoredDiscoverSession
): Promise<StoredSession> => {
  const { core } = await context.resolve(['core']);
  return core.savedObjects.client.create<DiscoverSessionAttributes>(SavedSearchType, attributes, {
    references,
  });
};

/** Resolves a session while preserving alias metadata for the caller. */
export const getStoredDiscoverSession = async (
  context: RequestHandlerContext,
  id: string
): Promise<{ savedObject: StoredSession; resolveHeaders: Record<string, string> }> => {
  const { core } = await context.resolve(['core']);
  const {
    saved_object: savedObject,
    outcome,
    alias_target_id: aliasTargetId,
    alias_purpose: aliasPurpose,
  } = await core.savedObjects.client.resolve<DiscoverSessionAttributes>(SavedSearchType, id);

  if (isSavedObjectErrorResult(savedObject)) {
    throw SavedObjectsErrorHelpers.createGenericNotFoundError(SavedSearchType, id);
  }

  const resolveHeaders: Record<string, string> = { 'kbn-resolve-outcome': outcome };
  if (aliasTargetId) {
    resolveHeaders['kbn-resolve-alias-target-id'] = aliasTargetId;
  }
  if (aliasPurpose) {
    resolveHeaders['kbn-resolve-purpose'] = aliasPurpose;
  }

  return { savedObject, resolveHeaders };
};

/** Resolves once, prepares the replacement using existing attributes, and persists the session. */
export const upsertStoredDiscoverSession = async (
  context: RequestHandlerContext,
  id: string,
  prepareDocument: (existingAttributes?: DiscoverSessionAttributes) => StoredDiscoverSession
): Promise<{ savedObject: StoredSession; operation: 'create' | 'update' }> => {
  const { core } = await context.resolve(['core']);
  let resolvedId = id;
  let existingAttributes: DiscoverSessionAttributes | undefined;

  try {
    const result = await core.savedObjects.client.resolve<DiscoverSessionAttributes>(
      SavedSearchType,
      id
    );
    if (result.outcome === 'conflict') {
      throw SavedObjectsErrorHelpers.createConflictError(SavedSearchType, id);
    }

    resolvedId = result.saved_object.id;
    if (!isSavedObjectErrorResult(result.saved_object)) {
      existingAttributes = result.saved_object.attributes;
    }
  } catch (error) {
    if (!SavedObjectsErrorHelpers.isNotFoundError(error)) {
      throw error;
    }
    // Existing legacy IDs are accepted; only newly created IDs follow the API's naming rules.
    asCodeIdSchema.parse(id);
  }

  const { attributes, references } = prepareDocument(existingAttributes);
  const updateResponse = await core.savedObjects.client.update<DiscoverSessionAttributes>(
    SavedSearchType,
    resolvedId,
    attributes,
    { upsert: attributes, references, mergeAttributes: false }
  );
  const savedObject = await core.savedObjects.client.get<DiscoverSessionAttributes>(
    SavedSearchType,
    updateResponse.id
  );

  return { savedObject, operation: updateResponse.created_at ? 'create' : 'update' };
};
