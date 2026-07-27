/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import React, { useState } from 'react';
import {
  EuiAccordion,
  EuiButton,
  EuiButtonEmpty,
  EuiCheckableCard,
  EuiCodeBlock,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFormRow,
  EuiIcon,
  EuiModal,
  EuiModalBody,
  EuiModalFooter,
  EuiModalHeader,
  EuiModalHeaderTitle,
  EuiPanel,
  EuiSpacer,
  EuiText,
  EuiTextArea,
  EuiTitle,
  useGeneratedHtmlId,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import { SELECTION_INVESTIGATION_MAX_GOAL_LENGTH } from '../../../../../../common/selection_investigation';
import { formatTimeRange } from './formatters';
import type { InvestigationLauncherContext } from './types';

const INVESTIGATION_MISSIONS = [
  {
    id: 'strongest_lead',
    title: i18n.translate('discover.investigateSelection.goal.strongestLead.title', {
      defaultMessage: 'Find the strongest lead',
    }),
    description: i18n.translate('discover.investigateSelection.goal.strongestLead.description', {
      defaultMessage: 'Identify a meaningful change and follow the strongest lead.',
    }),
    goal: i18n.translate('discover.investigateSelection.goal.strongestLead.goal', {
      defaultMessage:
        'Find the strongest meaningful change in this period and follow the most useful lead toward an explanation.',
    }),
  },
  {
    id: 'affected_population',
    title: i18n.translate('discover.investigateSelection.goal.affectedPopulation.title', {
      defaultMessage: "Identify what's affected",
    }),
    description: i18n.translate(
      'discover.investigateSelection.goal.affectedPopulation.description',
      {
        defaultMessage:
          'Determine whether the activity is concentrated by service, host, user, or another group.',
      }
    ),
    goal: i18n.translate('discover.investigateSelection.goal.affectedPopulation.goal', {
      defaultMessage:
        'Find who or what was most affected in this period, then investigate what stands out.',
    }),
  },
  {
    id: 'deployment_signals',
    title: i18n.translate('discover.investigateSelection.goal.deploymentSignals.title', {
      defaultMessage: 'Look for deployment signals',
    }),
    description: i18n.translate(
      'discover.investigateSelection.goal.deploymentSignals.description',
      {
        defaultMessage: 'Check versions, images, restarts, rollout markers, and their timing.',
      }
    ),
    goal: i18n.translate('discover.investigateSelection.goal.deploymentSignals.goal', {
      defaultMessage:
        'Look for deployment-related signals in this period, including version or image transitions, restart or rollout markers, and their timing.',
    }),
  },
] as const;

export const InvestigationLauncher = ({
  context,
  goal,
  onGoalChange,
  onClose,
  onStart,
}: {
  context: InvestigationLauncherContext;
  goal: string;
  onGoalChange: (goal: string) => void;
  onClose: () => void;
  onStart: () => void;
}) => {
  const modalTitleId = useGeneratedHtmlId({
    prefix: 'discover-investigation-launcher-title',
  });
  const [selectedMissionId, setSelectedMissionId] = useState<string>();
  const [fromMs, toMs] = context.range;
  const selection = {
    from: new Date(Math.min(fromMs, toMs)).toISOString(),
    to: new Date(Math.max(fromMs, toMs)).toISOString(),
  };
  const canStart = goal.trim().length > 0;

  return (
    <EuiModal
      onClose={onClose}
      aria-labelledby={modalTitleId}
      css={{ inlineSize: 600 }}
      data-test-subj="discoverInvestigationLauncher"
    >
      <EuiModalHeader>
        <EuiModalHeaderTitle id={modalTitleId}>
          {i18n.translate('discover.investigateSelection.launcher.title', {
            defaultMessage: 'Investigate selected period',
          })}
        </EuiModalHeaderTitle>
      </EuiModalHeader>
      <EuiModalBody>
        <EuiTitle size="xs">
          <h3>
            {i18n.translate('discover.investigateSelection.launcher.goalLabel', {
              defaultMessage: 'What should Discover investigate?',
            })}
          </h3>
        </EuiTitle>
        <EuiSpacer size="m" />
        <EuiFlexGroup direction="column" gutterSize="s" responsive={false}>
          {INVESTIGATION_MISSIONS.map((mission) => (
            <EuiFlexItem grow={false} key={mission.id}>
              <EuiCheckableCard
                id={`discover-investigation-mission-${mission.id}`}
                name="discover-investigation-mission"
                checked={selectedMissionId === mission.id}
                onChange={() => {
                  setSelectedMissionId(mission.id);
                  onGoalChange(mission.goal);
                }}
                label={
                  <>
                    <EuiText size="m">
                      <strong>{mission.title}</strong>
                    </EuiText>
                    <EuiText size="s" color="subdued">
                      <p>{mission.description}</p>
                    </EuiText>
                  </>
                }
              />
            </EuiFlexItem>
          ))}
          <EuiFlexItem grow={false}>
            <EuiCheckableCard
              id="discover-investigation-mission-custom"
              name="discover-investigation-mission"
              checked={selectedMissionId === 'custom'}
              onChange={() => {
                setSelectedMissionId('custom');
                onGoalChange('');
              }}
              label={
                <>
                  <EuiText size="m">
                    <strong>
                      {i18n.translate('discover.investigateSelection.goal.customQuestion.title', {
                        defaultMessage: 'Investigate another question',
                      })}
                    </strong>
                  </EuiText>
                  <EuiText size="s" color="subdued">
                    <p>
                      {i18n.translate(
                        'discover.investigateSelection.goal.customQuestion.description',
                        {
                          defaultMessage: 'Define a specific outcome for this investigation.',
                        }
                      )}
                    </p>
                  </EuiText>
                </>
              }
            />
          </EuiFlexItem>
        </EuiFlexGroup>
        {selectedMissionId === 'custom' && (
          <>
            <EuiSpacer size="m" />
            <EuiFormRow
              fullWidth
              label={i18n.translate('discover.investigateSelection.launcher.customGoalLabel', {
                defaultMessage: 'Investigation goal',
              })}
            >
              <EuiTextArea
                autoFocus
                fullWidth
                rows={3}
                value={goal}
                maxLength={SELECTION_INVESTIGATION_MAX_GOAL_LENGTH}
                placeholder={i18n.translate(
                  'discover.investigateSelection.launcher.goalPlaceholder',
                  {
                    defaultMessage:
                      'For example, determine whether errors affect only mobile clients',
                  }
                )}
                onChange={(event) => onGoalChange(event.target.value)}
                data-test-subj="discoverInvestigationGoal"
              />
            </EuiFormRow>
          </>
        )}
        <EuiSpacer size="l" />
        <EuiPanel color="subdued" paddingSize="s">
          <EuiAccordion
            id="discover-investigation-scope"
            buttonContent={
              <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
                <EuiFlexItem grow={false}>
                  <EuiIcon type="lock" color="subdued" aria-hidden={true} />
                </EuiFlexItem>
                <EuiFlexItem>
                  <EuiText size="s">
                    <strong>
                      {i18n.translate('discover.investigateSelection.launcher.scopeTitle', {
                        defaultMessage: 'Scope for this run',
                      })}
                    </strong>
                    <br />
                    <span>
                      {i18n.translate('discover.investigateSelection.launcher.scopeSummary', {
                        defaultMessage: 'Selected period · Current ES|QL · Read-only',
                      })}
                    </span>
                  </EuiText>
                </EuiFlexItem>
              </EuiFlexGroup>
            }
            paddingSize="m"
          >
            <EuiText size="s">
              <p>
                <strong>
                  {i18n.translate('discover.investigateSelection.launcher.selectionLabel', {
                    defaultMessage: 'Selected period',
                  })}
                </strong>
                <br />
                {formatTimeRange(selection)}
              </p>
              <p>
                {context.filters.length > 0
                  ? i18n.translate('discover.investigateSelection.launcher.activeFilters', {
                      defaultMessage:
                        '{filterCount, plural, one {# active filter} other {# active filters}}',
                      values: { filterCount: context.filters.length },
                    })
                  : i18n.translate('discover.investigateSelection.launcher.noFilters', {
                      defaultMessage: 'No additional filters',
                    })}
              </p>
            </EuiText>
            <EuiCodeBlock language="esql" fontSize="s" paddingSize="s" overflowHeight={120}>
              {context.query}
            </EuiCodeBlock>
          </EuiAccordion>
        </EuiPanel>
      </EuiModalBody>
      <EuiModalFooter>
        <EuiButtonEmpty onClick={onClose}>
          {i18n.translate('discover.investigateSelection.launcher.cancel', {
            defaultMessage: 'Cancel',
          })}
        </EuiButtonEmpty>
        <EuiButton
          fill
          iconType="search"
          disabled={!canStart}
          onClick={onStart}
          data-test-subj="discoverInvestigationStart"
        >
          {i18n.translate('discover.investigateSelection.launcher.start', {
            defaultMessage: 'Start investigation',
          })}
        </EuiButton>
      </EuiModalFooter>
    </EuiModal>
  );
};
