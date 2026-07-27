/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { i18n } from '@kbn/i18n';
import type { InvestigationProgressStep } from '../../../../../../common/selection_investigation';

const investigationDateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const investigationHeaderDateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const formatInvestigationTimestamp = (value: string): string =>
  investigationDateTimeFormatter.format(new Date(value));

export const formatTimeRange = ({ from, to }: { from: string; to: string }): string => {
  return `${formatInvestigationTimestamp(from)} – ${formatInvestigationTimestamp(to)}`;
};

export const formatHeaderTimeRange = ({ from, to }: { from: string; to: string }): string =>
  `${investigationHeaderDateTimeFormatter.format(
    new Date(from)
  )} → ${investigationHeaderDateTimeFormatter.format(new Date(to))}`;

export const formatInvestigationCount = (value: number) => new Intl.NumberFormat().format(value);

export const formatInvestigationDuration = (durationMs: number) =>
  durationMs < 1000 ? `${durationMs} ms` : `${(durationMs / 1000).toFixed(1)} s`;

const MAX_VALUE_LABEL_LENGTH = 40;

export const truncateValue = (value: string | number | boolean | null) => {
  const text = value === null ? 'null' : String(value);

  return text.length > MAX_VALUE_LABEL_LENGTH ? `${text.slice(0, MAX_VALUE_LABEL_LENGTH)}…` : text;
};

export const splitFindingSummary = (summary: string) => {
  const match = summary.match(/^(.+?[.!?])(?=\s|$)\s*(.*)$/);
  return {
    preview: match?.[1] ?? summary,
    details: match?.[2],
  };
};

export const readableField = (field?: string): string => {
  if (field === 'event.dataset') {
    return i18n.translate('discover.investigateSelection.field.dataSource', {
      defaultMessage: 'Data source',
    });
  }
  if (field === 'request.keyword' || field === 'http.request.method') {
    return i18n.translate('discover.investigateSelection.field.request', {
      defaultMessage: 'Request',
    });
  }
  if (field === 'url.keyword' || field === 'url.full' || field === 'url.path') {
    return i18n.translate('discover.investigateSelection.field.url', {
      defaultMessage: 'URL',
    });
  }
  if (field === 'response.keyword' || field === 'http.response.status_code') {
    return i18n.translate('discover.investigateSelection.field.responseCode', {
      defaultMessage: 'Response code',
    });
  }
  if (field === 'host.name' || field === 'host.keyword') {
    return i18n.translate('discover.investigateSelection.field.host', {
      defaultMessage: 'Host',
    });
  }
  if (field === 'clientip' || field === 'client.ip' || field === 'source.ip') {
    return i18n.translate('discover.investigateSelection.field.clientIp', {
      defaultMessage: 'Client IP',
    });
  }
  if (field === 'geo.src' || field === 'geo.dest') {
    return i18n.translate('discover.investigateSelection.field.location', {
      defaultMessage: 'Location',
    });
  }
  if (field === 'service.name') {
    return i18n.translate('discover.investigateSelection.field.service', {
      defaultMessage: 'Service',
    });
  }
  return (
    field ??
    i18n.translate('discover.investigateSelection.field.activity', {
      defaultMessage: 'Activity',
    })
  );
};

export const stepLabel = ({ phase, status, label }: InvestigationProgressStep): string => {
  if (label) {
    return label;
  }
  if (phase === 'planning') {
    return i18n.translate('discover.investigateSelection.step.planning', {
      defaultMessage: 'Choosing what to check first',
    });
  }
  if (phase === 'synthesis') {
    return i18n.translate('discover.investigateSelection.step.synthesis', {
      defaultMessage: 'Preparing the summary',
    });
  }
  return status === 'start'
    ? i18n.translate('discover.investigateSelection.step.runningCheck', {
        defaultMessage: 'Running a check',
      })
    : i18n.translate('discover.investigateSelection.step.completedCheck', {
        defaultMessage: 'Completed a check',
      });
};
