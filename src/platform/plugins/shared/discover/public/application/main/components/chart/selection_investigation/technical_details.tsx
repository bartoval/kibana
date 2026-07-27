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
  EuiBasicTable,
  EuiFlexGroup,
  EuiFlexItem,
  EuiIcon,
  EuiLoadingSpinner,
  EuiPanel,
  EuiSpacer,
  EuiText,
  EuiTitle,
  EuiToolTip,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import type {
  InvestigationFinding,
  InvestigationProgressStep,
  SelectionInvestigationResult,
} from '../../../../../../common/selection_investigation';
import { formatInvestigationDuration, stepLabel } from './formatters';

const TechnicalFindingDetails = ({ finding }: { finding: InvestigationFinding }) => {
  return (
    <EuiAccordion
      id={`discoverInvestigationTechnicalFinding-${finding.id}`}
      buttonContent={finding.title}
      paddingSize="m"
    >
      <EuiText size="s" color="subdued">
        <p css={{ overflowWrap: 'anywhere' }}>
          {i18n.translate('discover.investigateSelection.technical.lineage', {
            defaultMessage: 'Evidence lineage: {lineage}',
            values: { lineage: finding.dimension },
          })}
        </p>
        <p>
          {i18n.translate('discover.investigateSelection.findingFilterCount', {
            defaultMessage: '{filterCount, plural, one {# frozen filter} other {# frozen filters}}',
            values: { filterCount: finding.filterCount },
          })}
        </p>
      </EuiText>
      {finding.kind === 'pattern' && (
        <>
          <EuiText size="s" color="subdued">
            <p>
              {i18n.translate('discover.investigateSelection.generatedPatternHelp', {
                defaultMessage:
                  'Generated patterns show the fixed structure shared by similar messages; wildcard sections represent values that vary. Hover a value to read it in full.',
              })}
            </p>
          </EuiText>
          <EuiSpacer size="s" />
        </>
      )}
      <EuiBasicTable
        items={finding.preview}
        columns={[
          {
            field: 'key',
            name:
              finding.kind === 'pattern'
                ? i18n.translate('discover.investigateSelection.preview.generatedPattern', {
                    defaultMessage: 'Generated pattern',
                  })
                : i18n.translate('discover.investigateSelection.preview.key', {
                    defaultMessage: 'Value',
                  }),
            width: '55%',
            render: (value: string) => (
              <EuiToolTip
                position="top"
                content={
                  <span css={{ display: 'block', maxInlineSize: 480, overflowWrap: 'anywhere' }}>
                    {value}
                  </span>
                }
              >
                <span
                  tabIndex={0}
                  css={{
                    display: '-webkit-box',
                    overflow: 'hidden',
                    overflowWrap: 'anywhere',
                    WebkitBoxOrient: 'vertical',
                    WebkitLineClamp: 2,
                  }}
                >
                  {value}
                </span>
              </EuiToolTip>
            ),
          },
          {
            field: 'selectionValue',
            name: i18n.translate('discover.investigateSelection.preview.selection', {
              defaultMessage: 'Selection',
            }),
            dataType: 'number',
          },
          {
            field: 'baselineValue',
            name: i18n.translate('discover.investigateSelection.preview.baseline', {
              defaultMessage: 'Baseline',
            }),
            dataType: 'number',
          },
          {
            field: 'delta',
            name: i18n.translate('discover.investigateSelection.preview.delta', {
              defaultMessage: 'Delta',
            }),
            dataType: 'number',
          },
        ]}
        tableCaption={i18n.translate('discover.investigateSelection.preview.caption', {
          defaultMessage: 'Aggregated evidence preview',
        })}
        data-test-subj="discoverInvestigationEvidencePreview"
      />
    </EuiAccordion>
  );
};

export const TechnicalInvestigationTimeline = ({
  steps,
  timings,
  findings,
}: {
  steps: InvestigationProgressStep[];
  timings?: SelectionInvestigationResult['timings'];
  findings: InvestigationFinding[];
}) => (
  <EuiFlexGroup
    direction="column"
    gutterSize="m"
    responsive={false}
    data-test-subj="discoverInvestigationTechnicalTimeline"
  >
    {timings && (
      <EuiFlexItem grow={false}>
        <EuiPanel hasBorder paddingSize="m">
          <EuiTitle size="xs">
            <h4>
              {i18n.translate('discover.investigateSelection.timings.heading', {
                defaultMessage: 'Runtime timings',
              })}
            </h4>
          </EuiTitle>
          <EuiSpacer size="s" />
          <EuiFlexGroup direction="column" gutterSize="xs" responsive={false}>
            {[
              {
                key: 'planning',
                label: i18n.translate('discover.investigateSelection.timings.planningAndSetup', {
                  defaultMessage: 'Planning and setup',
                }),
                value: timings.planningAndSetupMs,
              },
              {
                key: 'verification',
                label: i18n.translate(
                  'discover.investigateSelection.timings.verificationDecision',
                  {
                    defaultMessage: 'Verification decision',
                  }
                ),
                value: timings.verificationDecisionMs,
              },
              {
                key: 'synthesis',
                label: i18n.translate('discover.investigateSelection.timings.handoffAndSynthesis', {
                  defaultMessage: 'Handoff and structured answer',
                }),
                value: timings.handoffAndSynthesisMs,
              },
              {
                key: 'total',
                label: i18n.translate('discover.investigateSelection.timings.total', {
                  defaultMessage: 'Total Agent Builder time',
                }),
                value: timings.totalAgentMs,
              },
            ]
              .filter(
                (timing): timing is { key: string; label: string; value: number } =>
                  timing.value !== undefined
              )
              .map((timing) => (
                <EuiFlexItem grow={false} key={timing.key}>
                  <EuiFlexGroup gutterSize="m" justifyContent="spaceBetween" responsive={false}>
                    <EuiFlexItem>
                      <EuiText size="s" color="subdued">
                        <p>{timing.label}</p>
                      </EuiText>
                    </EuiFlexItem>
                    <EuiFlexItem grow={false}>
                      <EuiText size="s">
                        <p>{formatInvestigationDuration(timing.value)}</p>
                      </EuiText>
                    </EuiFlexItem>
                  </EuiFlexGroup>
                </EuiFlexItem>
              ))}
            <EuiFlexItem grow={false}>
              <EuiFlexGroup gutterSize="m" justifyContent="spaceBetween" responsive={false}>
                <EuiFlexItem>
                  <EuiText size="s" color="subdued">
                    <p>
                      {i18n.translate(
                        'discover.investigateSelection.timings.investigativeDecisions',
                        { defaultMessage: 'Investigative decision turns' }
                      )}
                    </p>
                  </EuiText>
                </EuiFlexItem>
                <EuiFlexItem grow={false}>
                  <EuiText size="s">
                    <p>{timings.investigativeDecisionCount}</p>
                  </EuiText>
                </EuiFlexItem>
              </EuiFlexGroup>
            </EuiFlexItem>
          </EuiFlexGroup>
        </EuiPanel>
      </EuiFlexItem>
    )}
    {findings.length > 0 && (
      <EuiFlexItem grow={false}>
        <EuiPanel hasBorder paddingSize="m">
          <EuiTitle size="xs">
            <h4>
              {i18n.translate('discover.investigateSelection.technical.findings', {
                defaultMessage: 'Finding evidence',
              })}
            </h4>
          </EuiTitle>
          <EuiSpacer size="s" />
          <EuiFlexGroup direction="column" gutterSize="s" responsive={false}>
            {findings.map((finding) => (
              <EuiFlexItem grow={false} key={finding.id}>
                <TechnicalFindingDetails finding={finding} />
              </EuiFlexItem>
            ))}
          </EuiFlexGroup>
        </EuiPanel>
      </EuiFlexItem>
    )}
    {steps.map((step) => {
      return (
        <EuiFlexItem key={step.stepId} grow={false} css={{ paddingBlock: 4 }}>
          <EuiFlexGroup gutterSize="m" alignItems="center" responsive={false}>
            <EuiFlexItem grow={false}>
              {step.status === 'start' ? (
                <EuiLoadingSpinner size="m" />
              ) : (
                <EuiIcon
                  type={step.status === 'success' ? 'check' : 'cross'}
                  color={step.status === 'success' ? 'success' : 'danger'}
                  aria-hidden={true}
                />
              )}
            </EuiFlexItem>
            <EuiFlexItem>
              <EuiText size="m" color={step.status === 'start' ? 'default' : 'subdued'}>
                <p>{stepLabel(step)}</p>
              </EuiText>
              {step.rationale && (
                <EuiText size="s" color="subdued">
                  <p>{step.rationale}</p>
                </EuiText>
              )}
              <EuiSpacer size="xs" />
              <EuiText size="xs" color="subdued">
                <p>
                  {step.stepId}
                  {step.result ? ` · ${step.result.rowCount} rows` : ''}
                  {step.result?.esqlExecutionMs !== undefined
                    ? ` · ${step.result.esqlExecutionMs} ms ES|QL`
                    : ''}
                </p>
              </EuiText>
            </EuiFlexItem>
          </EuiFlexGroup>
        </EuiFlexItem>
      );
    })}
  </EuiFlexGroup>
);
