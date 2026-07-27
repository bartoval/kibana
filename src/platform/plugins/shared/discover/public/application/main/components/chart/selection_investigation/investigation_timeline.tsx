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
  EuiFlexGroup,
  EuiFlexItem,
  EuiIcon,
  EuiLoadingSpinner,
  EuiPanel,
  EuiSpacer,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import type { InvestigationProgressStep } from '../../../../../../common/selection_investigation';
import { stepLabel } from './formatters';

const getActiveStageLabel = (
  steps: InvestigationProgressStep[],
  isRunning: boolean
): string | undefined => {
  if (!isRunning) {
    return;
  }

  const checks = steps.filter(({ phase }) => phase === 'query');
  const synthesis = steps.find(({ phase }) => phase === 'synthesis');
  if (synthesis?.status === 'start') {
    return i18n.translate('discover.investigateSelection.step.puttingTogether', {
      defaultMessage: 'Preparing the summary…',
    });
  }

  if (checks.some(({ status }) => status === 'start')) {
    return;
  }

  if (checks.length > 0) {
    return i18n.translate('discover.investigateSelection.step.reviewingResults', {
      defaultMessage: 'Reviewing the results and choosing what to check next…',
    });
  }

  return i18n.translate('discover.investigateSelection.step.choosingChecks', {
    defaultMessage: 'Choosing what to check…',
  });
};

const InvestigationActiveStage = ({ label }: { label: string }) => (
  <EuiPanel hasBorder paddingSize="m">
    <EuiFlexGroup gutterSize="m" alignItems="center" responsive={false}>
      <EuiFlexItem grow={false} css={{ inlineSize: 24 }}>
        <EuiLoadingSpinner size="m" />
      </EuiFlexItem>
      <EuiFlexItem>
        <EuiText size="m">
          <strong>{label}</strong>
        </EuiText>
      </EuiFlexItem>
    </EuiFlexGroup>
  </EuiPanel>
);

const InvestigationCheckRow = ({ step }: { step: InvestigationProgressStep }) => {
  const icon =
    step.status === 'start'
      ? undefined
      : step.status === 'failure'
      ? { type: 'cross' as const, color: 'danger' as const }
      : { type: 'check' as const, color: 'success' as const };

  return (
    <EuiFlexGroup
      gutterSize="m"
      alignItems="flexStart"
      responsive={false}
      css={{ paddingBlock: 8 }}
    >
      <EuiFlexItem grow={false} css={{ inlineSize: 24, paddingBlockStart: 3 }}>
        {step.status === 'start' ? (
          <EuiLoadingSpinner size="m" />
        ) : (
          <EuiIcon type={icon!.type} color={icon!.color} aria-hidden={true} />
        )}
      </EuiFlexItem>
      <EuiFlexItem css={{ minInlineSize: 0 }}>
        <EuiText size="m">
          <strong>{stepLabel(step)}</strong>
        </EuiText>
        {step.status === 'failure' && (
          <>
            <EuiSpacer size="xs" />
            <EuiText size="m" color="danger">
              <p>
                {i18n.translate('discover.investigateSelection.step.failed', {
                  defaultMessage: 'This check couldn’t be completed',
                })}
              </p>
            </EuiText>
          </>
        )}
      </EuiFlexItem>
    </EuiFlexGroup>
  );
};

const InvestigationCheckGroup = ({
  title,
  description,
  steps,
}: {
  title?: string;
  description?: string;
  steps: InvestigationProgressStep[];
}) => {
  if (steps.length === 0) {
    return null;
  }
  return (
    <EuiPanel hasBorder paddingSize="m">
      {title && (
        <>
          <EuiTitle size="xs">
            <h4>{title}</h4>
          </EuiTitle>
          {description && (
            <>
              <EuiSpacer size="xs" />
              <EuiText size="m" color="subdued">
                <p>{description}</p>
              </EuiText>
            </>
          )}
          <EuiSpacer size="s" />
        </>
      )}
      <EuiFlexGroup direction="column" gutterSize="s" responsive={false}>
        {steps.map((step) => (
          <EuiFlexItem key={step.stepId} grow={false}>
            <InvestigationCheckRow step={step} />
          </EuiFlexItem>
        ))}
      </EuiFlexGroup>
    </EuiPanel>
  );
};

export const InvestigationTimeline = ({
  steps,
  isRunning = false,
}: {
  steps: InvestigationProgressStep[];
  isRunning?: boolean;
}) => {
  const explorationSteps = steps.filter(({ wave }) => wave === 'exploration');
  const verificationSteps = steps.filter(({ wave }) => wave === 'verification');
  const ungroupedChecks = steps.filter(({ phase, wave }) => !wave && phase === 'query');
  const verificationRationale = verificationSteps.find(({ rationale }) => rationale)?.rationale;
  const explorationFinished = explorationSteps.every(({ status }) => status !== 'start');
  const verificationFinished = verificationSteps.every(({ status }) => status !== 'start');
  const activeStageLabel = getActiveStageLabel(steps, isRunning);

  return (
    <EuiFlexGroup
      direction="column"
      gutterSize="l"
      responsive={false}
      data-test-subj="discoverInvestigationTimeline"
    >
      {explorationSteps.length > 0 && (
        <EuiFlexItem grow={false}>
          <InvestigationCheckGroup
            title={
              explorationFinished
                ? i18n.translate('discover.investigateSelection.wave.explorationComplete', {
                    defaultMessage:
                      'Checked {count, plural, one {# area} other {# areas}} in parallel',
                    values: { count: explorationSteps.length },
                  })
                : i18n.translate('discover.investigateSelection.wave.exploration', {
                    defaultMessage:
                      'Checking {count, plural, one {# area} other {# areas}} in parallel',
                    values: { count: explorationSteps.length },
                  })
            }
            description={i18n.translate(
              'discover.investigateSelection.wave.explorationDescription',
              {
                defaultMessage:
                  'Each check below shows the field, time window, or message pattern being tested.',
              }
            )}
            steps={explorationSteps}
          />
        </EuiFlexItem>
      )}
      {verificationSteps.length > 0 && (
        <EuiFlexItem grow={false}>
          <InvestigationCheckGroup
            title={
              verificationFinished
                ? i18n.translate('discover.investigateSelection.wave.verificationComplete', {
                    defaultMessage: 'Checked the strongest result in more detail',
                  })
                : i18n.translate('discover.investigateSelection.wave.verification', {
                    defaultMessage: 'Checking the strongest result in more detail',
                  })
            }
            description={verificationRationale}
            steps={verificationSteps}
          />
        </EuiFlexItem>
      )}
      {ungroupedChecks.length > 0 && (
        <EuiFlexItem grow={false}>
          <InvestigationCheckGroup
            title={i18n.translate('discover.investigateSelection.wave.completedChecks', {
              defaultMessage: 'What was checked',
            })}
            steps={ungroupedChecks}
          />
        </EuiFlexItem>
      )}
      {activeStageLabel && (
        <EuiFlexItem grow={false}>
          <InvestigationActiveStage label={activeStageLabel} />
        </EuiFlexItem>
      )}
    </EuiFlexGroup>
  );
};
