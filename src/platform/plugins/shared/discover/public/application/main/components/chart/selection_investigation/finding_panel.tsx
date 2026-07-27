/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import React from 'react';
import {
  EuiAccordion,
  EuiButton,
  EuiCodeBlock,
  EuiDescriptionList,
  EuiFlexGroup,
  EuiFlexItem,
  EuiPanel,
  EuiProgress,
  EuiSpacer,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import type { InvestigationFinding } from '../../../../../../common/selection_investigation';
import {
  formatInvestigationCount,
  formatTimeRange,
  readableField,
  splitFindingSummary,
  truncateValue,
} from './formatters';

const findingValueLabel = (finding: InvestigationFinding) =>
  finding.kind === 'pattern'
    ? i18n.translate('discover.investigateSelection.patternFallbackDescription', {
        defaultMessage: 'Grouped message pattern',
      })
    : truncateValue(finding.value);

const formatDeltaPercent = ({
  relativeChange,
  direction,
}: InvestigationFinding): string | undefined => {
  if (relativeChange === null) return undefined;
  // One decimal below 10% so a −4.6% does not round into silence; integers are enough above it.
  const percent =
    relativeChange >= 0.1
      ? Math.round(relativeChange * 100)
      : Math.round(relativeChange * 1000) / 10;
  const sign = direction === 'decreased' ? '−' : direction === 'increased' ? '+' : '';
  return `${sign}${percent}%`;
};

export const findingDeltaLabel = (finding: InvestigationFinding): string => {
  const percent = formatDeltaPercent(finding);
  if (percent) return percent;
  const sign =
    finding.direction === 'increased' ? '+' : finding.direction === 'decreased' ? '−' : '';
  return `${sign}${formatInvestigationCount(finding.absoluteChange)}`;
};

const formatDeltaValue = (finding: InvestigationFinding): string => {
  const change =
    finding.absoluteChange === 0
      ? '0'
      : `${finding.direction === 'increased' ? '+' : '−'}${formatInvestigationCount(
          finding.absoluteChange
        )}`;
  const percent = formatDeltaPercent(finding);

  return percent ? `${change} · ${percent}` : change;
};

const ComparisonBars = ({ finding }: { finding: InvestigationFinding }) => {
  const max = Math.max(finding.selectionValue, finding.baselineValue, 1);

  return (
    <EuiFlexGroup direction="column" gutterSize="m" responsive={false}>
      <EuiFlexItem grow={false}>
        <EuiFlexGroup
          alignItems="center"
          justifyContent="spaceBetween"
          gutterSize="s"
          responsive={false}
        >
          <EuiFlexItem>
            <EuiText size="s" color="subdued">
              <strong>
                {i18n.translate('discover.investigateSelection.metric.selection', {
                  defaultMessage: 'Selected period',
                })}
              </strong>
            </EuiText>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiText size="s">
              <strong>{formatInvestigationCount(finding.selectionValue)}</strong>
            </EuiText>
          </EuiFlexItem>
        </EuiFlexGroup>
        <EuiSpacer size="xs" />
        <EuiProgress
          value={finding.selectionValue}
          max={max}
          size="m"
          color="primary"
          aria-label={i18n.translate('discover.investigateSelection.metric.selection', {
            defaultMessage: 'Selected period',
          })}
        />
      </EuiFlexItem>
      <EuiFlexItem grow={false}>
        <EuiFlexGroup
          alignItems="center"
          justifyContent="spaceBetween"
          gutterSize="s"
          responsive={false}
        >
          <EuiFlexItem>
            <EuiText size="s" color="subdued">
              <strong>
                {i18n.translate('discover.investigateSelection.metric.baseline', {
                  defaultMessage: 'Previous period',
                })}
              </strong>
            </EuiText>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiText size="s">
              <strong>{formatInvestigationCount(finding.baselineValue)}</strong>
            </EuiText>
          </EuiFlexItem>
        </EuiFlexGroup>
        <EuiSpacer size="xs" />
        <EuiProgress
          value={finding.baselineValue}
          max={max}
          size="m"
          color="subdued"
          aria-label={i18n.translate('discover.investigateSelection.metric.baseline', {
            defaultMessage: 'Previous period',
          })}
        />
      </EuiFlexItem>
    </EuiFlexGroup>
  );
};

const FindingSummaryPreview = ({ summary }: { summary: string }) => {
  const { preview } = splitFindingSummary(summary);
  return (
    <EuiText size="m">
      <p>{preview}</p>
    </EuiText>
  );
};

export const FindingPanel = ({
  finding,
  onGoDeeper,
  investigationRanges,
  variant = 'primary',
}: {
  finding: InvestigationFinding;
  onGoDeeper: (finding: InvestigationFinding) => void;
  investigationRanges?: Pick<InvestigationFinding, 'selection' | 'baseline'>;
  variant?: 'primary' | 'supporting';
}) => {
  const isPrimary = variant === 'primary';
  const usesFocusedRanges =
    !investigationRanges ||
    finding.selection.from !== investigationRanges.selection.from ||
    finding.selection.to !== investigationRanges.selection.to ||
    finding.baseline.from !== investigationRanges.baseline.from ||
    finding.baseline.to !== investigationRanges.baseline.to;
  const summaryDetails = finding.summary ? splitFindingSummary(finding.summary).details : undefined;
  const dimensionLabel =
    finding.kind === 'pattern'
      ? i18n.translate('discover.investigateSelection.patternLabel', {
          defaultMessage: 'Similar log messages',
        })
      : readableField(finding.dimension);
  const dimensionTitle =
    finding.kind === 'metric'
      ? i18n.translate('discover.investigateSelection.findingMeasure', {
          defaultMessage: 'Measure',
        })
      : i18n.translate('discover.investigateSelection.findingBreakdown', {
          defaultMessage: 'Breakdown',
        });
  const comparisonDetails = [
    {
      title: dimensionTitle,
      description: dimensionLabel,
    },
    ...(finding.kind === 'metric'
      ? []
      : [
          {
            title: i18n.translate('discover.investigateSelection.findingValue', {
              defaultMessage: 'Value',
            }),
            description: findingValueLabel(finding),
          },
        ]),
    {
      title: i18n.translate('discover.investigateSelection.metric.selection', {
        defaultMessage: 'Selected period',
      }),
      description: formatInvestigationCount(finding.selectionValue),
    },
    {
      title: i18n.translate('discover.investigateSelection.metric.baseline', {
        defaultMessage: 'Previous period',
      }),
      description: formatInvestigationCount(finding.baselineValue),
    },
    {
      title: i18n.translate('discover.investigateSelection.findingChangeLabel', {
        defaultMessage: 'Change',
      }),
      description: formatDeltaValue(finding),
    },
  ];

  return (
    <EuiPanel
      hasBorder
      color={isPrimary ? 'plain' : 'subdued'}
      paddingSize={isPrimary ? 'l' : 'm'}
      css={
        isPrimary
          ? ({ euiTheme }) => ({
              borderInlineStart: `${euiTheme.border.width.thick} solid ${euiTheme.colors.primary}`,
            })
          : undefined
      }
      data-test-subj="discoverInvestigationFinding"
    >
      <EuiTitle size={isPrimary ? 's' : 'xs'}>
        <h3>{finding.title}</h3>
      </EuiTitle>
      {isPrimary && (
        <>
          <EuiSpacer size="m" />
          <ComparisonBars finding={finding} />
        </>
      )}
      <EuiSpacer size="m" />
      <FindingSummaryPreview summary={finding.summary} />
      <EuiSpacer size="m" />
      <EuiButton
        iconType="inspect"
        onClick={() => onGoDeeper(finding)}
        data-test-subj="discoverInvestigationGoDeeper"
      >
        {i18n.translate('discover.investigateSelection.goDeeper', {
          defaultMessage: 'Go deeper',
        })}
      </EuiButton>
      <EuiSpacer size="m" />
      <EuiAccordion
        id={`discoverInvestigationDetails-${finding.id}`}
        buttonContent={i18n.translate('discover.investigateSelection.viewEvidence', {
          defaultMessage: 'Show details',
        })}
        buttonProps={{ paddingSize: 's' }}
        paddingSize="s"
      >
        <EuiDescriptionList
          compressed
          type="column"
          columnWidths={[1, 2]}
          listItems={comparisonDetails}
        />
        {summaryDetails && (
          <>
            <EuiSpacer size="m" />
            <EuiText size="m">
              <p>{summaryDetails}</p>
            </EuiText>
          </>
        )}
        {usesFocusedRanges && (
          <>
            <EuiSpacer size="m" />
            <EuiTitle size="xxs">
              <h4>
                {i18n.translate('discover.investigateSelection.findingComparedWindows', {
                  defaultMessage: 'Compared windows',
                })}
              </h4>
            </EuiTitle>
            <EuiSpacer size="s" />
            <EuiDescriptionList
              compressed
              type="column"
              columnWidths={[1, 2]}
              listItems={[
                {
                  title: i18n.translate('discover.investigateSelection.findingRange.selection', {
                    defaultMessage: 'Selected',
                  }),
                  description: formatTimeRange(finding.selection),
                },
                {
                  title: i18n.translate('discover.investigateSelection.findingRange.previous', {
                    defaultMessage: 'Previous',
                  }),
                  description: formatTimeRange(finding.baseline),
                },
              ]}
            />
          </>
        )}
        <EuiSpacer size="l" />
        <EuiTitle size="xxs">
          <h4>
            {i18n.translate('discover.investigateSelection.findingQuery', {
              defaultMessage: 'Query used',
            })}
          </h4>
        </EuiTitle>
        <EuiSpacer size="s" />
        <EuiCodeBlock language="esql" paddingSize="s" fontSize="s" isCopyable>
          {finding.query}
        </EuiCodeBlock>
      </EuiAccordion>
    </EuiPanel>
  );
};
