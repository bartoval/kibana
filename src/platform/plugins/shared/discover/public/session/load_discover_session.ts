/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { ToastsStart } from '@kbn/core/public';
import { i18n } from '@kbn/i18n';
import type { DiscoverSession } from '@kbn/saved-search-plugin/common';
import type { DiscoverSessionPersistence } from './persistence';

/** Loads a Discover session and warns when the server omitted unsupported content. */
export const loadDiscoverSession = async ({
  id,
  persistence,
  toastNotifications,
}: {
  id: string;
  persistence: DiscoverSessionPersistence;
  toastNotifications: ToastsStart;
}): Promise<DiscoverSession> => {
  const { session, warnings } = await persistence.get(id);

  if (warnings.length) {
    toastNotifications.addWarning({
      title: i18n.translate('discover.sessionLoadWarnings.title', {
        defaultMessage: 'Some session content could not be loaded',
      }),
      text: i18n.translate('discover.sessionLoadWarnings.text', {
        defaultMessage:
          '{warningCount, plural, one {One part of this session was omitted.} other {# parts of this session were omitted.}} Saving this session will keep only the content currently shown.',
        values: { warningCount: warnings.length },
      }),
      'data-test-subj': 'discoverSessionLoadWarning',
    });
  }

  return session;
};
