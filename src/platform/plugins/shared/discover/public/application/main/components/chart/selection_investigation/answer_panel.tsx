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
  EuiFlexGroup,
  EuiFlexItem,
  EuiPanel,
  EuiSpacer,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import type { InvestigationAnswer } from '../../../../../../common/selection_investigation';

const answerStatus = (
  status: InvestigationAnswer['status'],
  hasFindings: boolean
): { color: 'success' | 'primary' | 'warning'; label: string } => {
  switch (status) {
    case 'supported':
      return {
        color: 'success',
        label: i18n.translate('discover.investigateSelection.answer.supported', {
          defaultMessage: 'Change found',
        }),
      };
    case 'partially_supported':
      return {
        color: 'primary',
        label: i18n.translate('discover.investigateSelection.answer.partiallySupported', {
          defaultMessage: 'Change found — cause still unclear',
        }),
      };
    case 'no_signal_found':
      return {
        color: 'primary',
        label: i18n.translate('discover.investigateSelection.answer.noSignalFound', {
          defaultMessage: 'No signal found in the completed checks',
        }),
      };
    case 'inconclusive':
      return {
        color: 'warning',
        label: hasFindings
          ? i18n.translate('discover.investigateSelection.answer.changesUnresolved', {
              defaultMessage: 'Change found — cause still unclear',
            })
          : i18n.translate('discover.investigateSelection.answer.inconclusive', {
              defaultMessage: 'No clear answer from the completed checks',
            }),
      };
    case 'insufficient_observability':
      return {
        color: 'primary',
        label: i18n.translate('discover.investigateSelection.answer.insufficientObservability', {
          defaultMessage: 'Question remains open',
        }),
      };
  }
};

export const AnswerPanel = ({
  answer,
  findingCount,
}: {
  answer: InvestigationAnswer;
  findingCount: number;
}) => {
  const status = answerStatus(answer.status, findingCount > 0);

  return (
    <EuiPanel hasBorder paddingSize="l" data-test-subj="discoverInvestigationAnswer">
      <EuiFlexGroup alignItems="center" justifyContent="spaceBetween" responsive={false}>
        <EuiFlexItem>
          <EuiText size="s" color="subdued">
            <strong>
              {i18n.translate('discover.investigateSelection.answer.heading', {
                defaultMessage: 'Summary',
              })}
            </strong>
          </EuiText>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiBadge color={status.color}>{status.label}</EuiBadge>
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer size="l" />
      <EuiTitle size="s">
        <h3>{answer.title}</h3>
      </EuiTitle>
      <EuiSpacer size="s" />
      <EuiText size="m">
        <p>{answer.summary}</p>
      </EuiText>
    </EuiPanel>
  );
};

export const InvestigationNextSteps = ({
  nextStep,
  followUps,
  onInvestigateFollowUp,
}: {
  nextStep: string;
  followUps: InvestigationAnswer['followUps'];
  onInvestigateFollowUp: (followUp: InvestigationAnswer['followUps'][number]) => void;
}) => {
  const [recommended, ...alternatives] = followUps;

  return (
    <EuiPanel color="subdued" paddingSize="l">
      <EuiTitle size="s">
        <h3>
          {i18n.translate('discover.investigateSelection.answer.nextStepsTitle', {
            defaultMessage: 'What to investigate next',
          })}
        </h3>
      </EuiTitle>
      <EuiSpacer size="s" />
      <EuiText size="m">
        <p>{nextStep}</p>
      </EuiText>
      {recommended && (
        <>
          <EuiSpacer size="m" />
          <div
            css={({ euiTheme }) => ({
              borderInlineStart: euiTheme.border.thick,
              paddingInlineStart: euiTheme.size.base,
            })}
          >
            <EuiText size="m">
              <p>
                <strong>{recommended.goal}</strong>
              </p>
            </EuiText>
            <EuiText size="s" color="subdued">
              <p>{recommended.reason}</p>
            </EuiText>
            <EuiSpacer size="m" />
            <EuiButton fill onClick={() => onInvestigateFollowUp(recommended)}>
              {i18n.translate('discover.investigateSelection.answer.continueDirection', {
                defaultMessage: 'Run this follow-up',
              })}
            </EuiButton>
          </div>
        </>
      )}
      {alternatives.length > 0 && (
        <>
          <EuiSpacer size="m" />
          <EuiAccordion
            id="discoverInvestigationAlternativeDirections"
            buttonContent={i18n.translate(
              'discover.investigateSelection.answer.alternativeDirections',
              {
                defaultMessage:
                  '{count, plural, one {# other direction} other {# other directions}}',
                values: { count: alternatives.length },
              }
            )}
            paddingSize="s"
          >
            <EuiFlexGroup direction="column" gutterSize="s" responsive={false}>
              {alternatives.map((followUp) => (
                <EuiFlexItem grow={false} key={followUp.goal}>
                  <EuiText size="m">
                    <p>
                      <strong>{followUp.goal}</strong>
                    </p>
                  </EuiText>
                  <EuiText size="s" color="subdued">
                    <p>{followUp.reason}</p>
                  </EuiText>
                  <EuiSpacer size="m" />
                  <div>
                    <EuiButton fill onClick={() => onInvestigateFollowUp(followUp)}>
                      {i18n.translate(
                        'discover.investigateSelection.answer.continueAlternativeDirection',
                        {
                          defaultMessage: 'Run this follow-up',
                        }
                      )}
                    </EuiButton>
                  </div>
                </EuiFlexItem>
              ))}
            </EuiFlexGroup>
          </EuiAccordion>
        </>
      )}
    </EuiPanel>
  );
};
