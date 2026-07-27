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
  EuiBadge,
  EuiButton,
  EuiButtonEmpty,
  EuiCallOut,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFlyout,
  EuiFlyoutBody,
  EuiFlyoutFooter,
  EuiFlyoutHeader,
  EuiPanel,
  EuiProgress,
  EuiSpacer,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import type {
  InvestigationFinding,
  InvestigationFollowUp,
} from '../../../../../../common/selection_investigation';
import { AnswerPanel, InvestigationNextSteps } from './answer_panel';
import { FindingPanel } from './finding_panel';
import { formatHeaderTimeRange } from './formatters';
import { TechnicalInvestigationTimeline } from './technical_details';
import { InvestigationTimeline } from './investigation_timeline';
import type { InvestigationFlyoutState } from './types';

export const InvestigationFlyout = ({
  state,
  onClose,
  onStop,
  onRetry,
  onInvestigateAnotherQuestion,
  onInvestigateFollowUp,
  onGoDeeper,
}: {
  state: InvestigationFlyoutState;
  onClose: () => void;
  onStop: () => void;
  onRetry: () => void;
  onInvestigateAnotherQuestion: () => void;
  onInvestigateFollowUp: (followUp: InvestigationFollowUp) => void;
  onGoDeeper: (finding: InvestigationFinding) => void;
}) => {
  const isRunning = state.status === 'running' && !state.result;
  const completedCheckCount = state.steps.filter(
    ({ phase, status }) => phase === 'query' && status === 'success'
  ).length;
  const investigationRanges =
    state.request && state.baseline
      ? { selection: state.request.selection, baseline: state.baseline }
      : undefined;

  return (
    <EuiFlyout
      aria-label={i18n.translate('discover.investigateSelection.flyoutAriaLabel', {
        defaultMessage: 'Investigation flyout',
      })}
      onClose={onClose}
      ownFocus={false}
      type="push"
      size="s"
      data-test-subj="discoverInvestigationFlyout"
    >
      <EuiFlyoutHeader hasBorder>
        <EuiTitle size="m">
          <h2>
            {i18n.translate('discover.investigateSelection.flyoutTitle', {
              defaultMessage: 'Investigation',
            })}
          </h2>
        </EuiTitle>
        {state.request?.goal && (
          <>
            <EuiSpacer size="s" />
            <EuiText size="m">
              <p>{state.request.goal}</p>
            </EuiText>
          </>
        )}
        {state.request && state.baseline && (
          <>
            <EuiSpacer size="m" />
            <EuiText size="s" color="subdued">
              <div
                css={({ euiTheme }) => ({
                  display: 'grid',
                  gridTemplateColumns: 'max-content minmax(0, 1fr)',
                  columnGap: euiTheme.size.m,
                  rowGap: euiTheme.size.xs,
                })}
              >
                <strong>
                  {i18n.translate('discover.investigateSelection.header.selected', {
                    defaultMessage: 'Selected',
                  })}
                </strong>
                <span>{formatHeaderTimeRange(state.request.selection)}</span>
                <strong>
                  {i18n.translate('discover.investigateSelection.header.previous', {
                    defaultMessage: 'Previous',
                  })}
                </strong>
                <span>{formatHeaderTimeRange(state.baseline)}</span>
              </div>
            </EuiText>
          </>
        )}
      </EuiFlyoutHeader>
      <EuiFlyoutBody>
        {isRunning && (
          <EuiPanel hasBorder paddingSize="l">
            <EuiTitle size="m">
              <h3>
                {i18n.translate('discover.investigateSelection.runningTitle', {
                  defaultMessage: 'Finding what stands out…',
                })}
              </h3>
            </EuiTitle>
            <EuiSpacer size="s" />
            <EuiText size="m" color="subdued">
              <p>
                {i18n.translate('discover.investigateSelection.runningDescription', {
                  defaultMessage:
                    'Checking the data from different angles and following the most useful lead.',
                })}
              </p>
            </EuiText>
            <EuiSpacer size="m" />
            <EuiProgress size="s" color="primary" />
            <EuiSpacer size="xl" />
            <div css={{ paddingInline: 4 }}>
              <InvestigationTimeline steps={state.steps} isRunning />
            </div>
          </EuiPanel>
        )}

        {state.result && (
          <>
            <AnswerPanel answer={state.result.answer} findingCount={state.result.findings.length} />
            <EuiSpacer size="l" />
            {state.result.findings.length > 0 && (
              <>
                <EuiTitle size="s">
                  <h3>
                    {i18n.translate('discover.investigateSelection.evidenceTrail.title', {
                      defaultMessage: 'What we found',
                    })}
                  </h3>
                </EuiTitle>
                <EuiSpacer size="xs" />
                <EuiText size="m" color="subdued">
                  <p>
                    {i18n.translate('discover.investigateSelection.evidenceTrail.description', {
                      defaultMessage:
                        'The strongest change comes first, followed by related findings.',
                    })}
                  </p>
                </EuiText>
                <EuiSpacer size="m" />
              </>
            )}
            {state.result.findings.length > 0 && (
              <>
                <FindingPanel
                  finding={state.result.findings[0]}
                  onGoDeeper={onGoDeeper}
                  investigationRanges={investigationRanges}
                />
                <EuiSpacer size="m" />
              </>
            )}
            {state.result.findings.length > 1 && (
              <>
                <EuiAccordion
                  id="discoverInvestigationSupportingFindings"
                  borders="all"
                  arrowDisplay="right"
                  buttonProps={{ paddingSize: 'm', style: { width: '100%' } }}
                  buttonContentClassName="eui-fullWidth"
                  paddingSize="m"
                  data-test-subj="discoverInvestigationSupportingFindings"
                  buttonContent={
                    <EuiFlexGroup
                      alignItems="center"
                      gutterSize="s"
                      justifyContent="spaceBetween"
                      responsive={false}
                    >
                      <EuiFlexItem>
                        <EuiTitle size="xs">
                          <h4>
                            {i18n.translate(
                              'discover.investigateSelection.supportingFindings.title',
                              {
                                defaultMessage: 'Related findings',
                              }
                            )}
                          </h4>
                        </EuiTitle>
                        <EuiText size="s" color="subdued">
                          <p>
                            {i18n.translate(
                              'discover.investigateSelection.supportingFindings.description',
                              {
                                defaultMessage:
                                  'Additional changes found during this investigation.',
                              }
                            )}
                          </p>
                        </EuiText>
                      </EuiFlexItem>
                      <EuiFlexItem grow={false}>
                        <EuiBadge color="hollow">{state.result.findings.length - 1}</EuiBadge>
                      </EuiFlexItem>
                    </EuiFlexGroup>
                  }
                >
                  <EuiFlexGroup direction="column" gutterSize="m" responsive={false}>
                    {state.result.findings.slice(1).map((finding) => (
                      <EuiFlexItem grow={false} key={finding.id}>
                        <FindingPanel
                          finding={finding}
                          onGoDeeper={onGoDeeper}
                          investigationRanges={investigationRanges}
                          variant="supporting"
                        />
                      </EuiFlexItem>
                    ))}
                  </EuiFlexGroup>
                </EuiAccordion>
              </>
            )}
            <EuiSpacer size="l" />
            <InvestigationNextSteps
              nextStep={state.result.answer.nextStep}
              followUps={state.result.answer.followUps}
              onInvestigateFollowUp={onInvestigateFollowUp}
            />
            <EuiSpacer size="m" />
          </>
        )}

        {state.status === 'aborted' && (
          <EuiCallOut announceOnMount color="warning" iconType="stop">
            <p>
              {i18n.translate('discover.investigateSelection.aborted', {
                defaultMessage: 'Investigation stopped.',
              })}
            </p>
          </EuiCallOut>
        )}
        {state.status === 'error' && (
          <EuiCallOut
            announceOnMount
            color="danger"
            iconType="error"
            title={i18n.translate('discover.investigateSelection.errorTitle', {
              defaultMessage: 'We couldn’t finish this investigation.',
            })}
          >
            <p>
              {i18n.translate('discover.investigateSelection.error', {
                defaultMessage: 'Your goal and selection are still here. You can run it again.',
              })}
            </p>
            <EuiText size="xs" color="subdued">
              <p>
                {i18n.translate('discover.investigateSelection.errorDetails', {
                  defaultMessage: 'Technical details: {code}{message}',
                  values: {
                    code: state.errorCode ?? 'execution_failed',
                    message: state.errorMessage ? ` — ${state.errorMessage}` : '',
                  },
                })}
              </p>
            </EuiText>
          </EuiCallOut>
        )}
        {!isRunning && state.steps.length > 0 && (
          <>
            <EuiSpacer size="l" />
            <EuiAccordion
              id="discoverInvestigationTimeline"
              buttonContent={i18n.translate('discover.investigateSelection.timelineTitle', {
                defaultMessage:
                  'What was checked ({count, plural, one {# completed check} other {# completed checks}})',
                values: { count: completedCheckCount },
              })}
              paddingSize="m"
              data-test-subj="discoverInvestigationTimelineAccordion"
            >
              <InvestigationTimeline steps={state.steps} />
            </EuiAccordion>
            <EuiSpacer size="m" />
            <EuiAccordion
              id="discoverInvestigationTechnicalDetails"
              buttonContent={i18n.translate('discover.investigateSelection.technicalDetailsTitle', {
                defaultMessage: 'Technical details',
              })}
              paddingSize="m"
              data-test-subj="discoverInvestigationTechnicalDetailsAccordion"
            >
              <TechnicalInvestigationTimeline
                steps={state.steps}
                timings={state.result?.timings}
                findings={state.result?.findings ?? []}
              />
            </EuiAccordion>
          </>
        )}
      </EuiFlyoutBody>
      <EuiFlyoutFooter>
        <EuiFlexGroup justifyContent="flexEnd" responsive={false}>
          {state.status === 'completed' && (
            <EuiFlexItem grow={false}>
              <EuiButtonEmpty
                onClick={onRetry}
                disabled={!state.request}
                data-test-subj="discoverInvestigationRetry"
              >
                {i18n.translate('discover.investigateSelection.retry', {
                  defaultMessage: 'Run again',
                })}
              </EuiButtonEmpty>
            </EuiFlexItem>
          )}
          <EuiFlexItem grow={false}>
            {state.status === 'running' ? (
              <EuiButton color="danger" onClick={onStop}>
                {i18n.translate('discover.investigateSelection.stop', {
                  defaultMessage: 'Stop',
                })}
              </EuiButton>
            ) : state.status === 'completed' ? (
              <EuiButton
                fill
                onClick={onInvestigateAnotherQuestion}
                disabled={!state.request}
                data-test-subj="discoverInvestigationAnotherQuestion"
              >
                {i18n.translate('discover.investigateSelection.investigateAnotherQuestion', {
                  defaultMessage: 'Investigate another question',
                })}
              </EuiButton>
            ) : (
              <EuiButton
                fill
                onClick={onRetry}
                disabled={!state.request}
                data-test-subj="discoverInvestigationRetry"
              >
                {i18n.translate('discover.investigateSelection.tryAgain', {
                  defaultMessage: 'Try again',
                })}
              </EuiButton>
            )}
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiFlyoutFooter>
    </EuiFlyout>
  );
};
