/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import React, {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
  EuiAccordion,
  EuiBasicTable,
  EuiBadge,
  EuiButton,
  EuiButtonEmpty,
  EuiCallOut,
  EuiCodeBlock,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFlyout,
  EuiFlyoutBody,
  EuiFlyoutFooter,
  EuiFlyoutHeader,
  EuiIcon,
  EuiLoadingSpinner,
  EuiPanel,
  EuiProgress,
  EuiSpacer,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import { DISCOVER_SELECTION_ACTIONS_TRIGGER_ID } from '@kbn/ui-actions-plugin/common/trigger_ids';
import { METRIC_TYPE } from '@kbn/analytics';
import { defer, type Subscription } from 'rxjs';
import { httpResponseIntoObservable } from '@kbn/sse-utils-client';
import type { ESQLControlVariable } from '@kbn/esql-types';
import type { Filter } from '@kbn/es-query';
import type {
  InvestigationFinding,
  InvestigationProgressStep,
  InvestigationScope,
  InvestigationTriage,
  SelectionInvestigationRequest,
  SelectionInvestigationResult,
  SelectionInvestigationSseEvent,
} from '../../../../../common/selection_investigation';
import { SELECTION_INVESTIGATION_ROUTE } from '../../../../../common/selection_investigation';
import { useDiscoverServices } from '../../../../hooks/use_discover_services';
import { createSelectionBrushActions } from './selection_brush_actions';
import { InvestigationPulse } from './assets/investigation_pulse';
import {
  coverageIssueMessage,
  deeperBlockedHint,
  findingCaveat,
  findingClaim,
  noMaterialChangeMessage,
  patternDescription,
  serverRankedFindingsMessage,
  triageActionLabel,
  triageSignalLabel,
  triageSummary,
  triageTitle,
  unexplainedChangeMessage,
} from './investigation_messages';
import {
  internalStateActions,
  useInternalStateDispatch,
  useInternalStateSelector,
} from '../../state_management/redux';

interface InvestigationBrushContext {
  range: number[];
  tabId: string;
  query: string;
  timeField: string;
  filters: Filter[];
  variables: ESQLControlVariable[];
  applySelection: () => void;
}

/** A completed investigation, kept so that stepping back shows what the user already saw. */
interface InvestigationSnapshot {
  request: SelectionInvestigationRequest;
  baseline?: { from: string; to: string };
  steps: InvestigationProgressStep[];
  result: SelectionInvestigationResult;
}

interface InvestigationRuntimeState {
  status: 'idle' | 'running' | 'completed' | 'aborted' | 'error';
  request?: SelectionInvestigationRequest;
  // Which Discover tab the investigation belongs to. Local only: the server never needs it.
  tabId?: string;
  baseline?: { from: string; to: string };
  steps: InvestigationProgressStep[];
  result?: SelectionInvestigationResult;
  errorCode?: string;
  errorMessage?: string;
  /**
   * Completed runs of the current lineage, indexed by how many scopes they had. The agent is not
   * deterministic, so stepping back restores the recorded run instead of asking for a new one.
   */
  history: InvestigationSnapshot[];
}

interface SelectionInvestigationContextValue {
  canInvestigate: boolean;
  handleBrush: (context: InvestigationBrushContext) => void;
  investigationTabId?: string;
  isFlyoutOpen: boolean;
  showInvestigation: () => void;
}

const SelectionInvestigationContext = createContext<SelectionInvestigationContextValue>({
  canInvestigate: false,
  handleBrush: () => undefined,
  isFlyoutOpen: false,
  showInvestigation: () => undefined,
});

const TELEMETRY_EVENT = {
  started: 'discover_selection_investigation_started',
  stopped: 'discover_selection_investigation_stopped',
  aborted: 'discover_selection_investigation_aborted',
  error: 'discover_selection_investigation_error',
  deeper: 'discover_selection_investigation_deeper',
  outcome: (outcome: string) => `discover_selection_investigation_${outcome}`,
} as const;

const initialState: InvestigationRuntimeState = {
  status: 'idle',
  steps: [],
  history: [],
};

const getInvestigationErrorCode = (error: Error): string => {
  const responseCode = (
    error as Error & {
      body?: {
        attributes?: {
          code?: unknown;
        };
      };
    }
  ).body?.attributes?.code;
  if (typeof responseCode === 'string') {
    return responseCode;
  }
  return 'code' in error && typeof error.code === 'string' ? error.code : 'execution_failed';
};

const getInvestigationErrorMessage = (error: Error): string => {
  const responseMessage = (
    error as Error & {
      body?: {
        message?: unknown;
      };
    }
  ).body?.message;
  return typeof responseMessage === 'string' ? responseMessage : error.message;
};

const triageColor = (priority: InvestigationTriage['priority']) =>
  priority === 'investigate_now' ? 'warning' : priority === 'monitor' ? 'primary' : 'success';

const MAX_VALUE_LABEL_LENGTH = 40;

const truncateValue = (value: string | number | boolean | null) => {
  const text = value === null ? 'null' : String(value);

  return text.length > MAX_VALUE_LABEL_LENGTH ? `${text.slice(0, MAX_VALUE_LABEL_LENGTH)}…` : text;
};

const InvestigationPath = ({
  path,
  lastLabel,
}: {
  path: InvestigationFinding['investigationPath'];
  lastLabel: string;
}) => (
  <EuiFlexGroup
    gutterSize="xs"
    alignItems="center"
    responsive={false}
    wrap
    data-test-subj="discoverInvestigationPath"
  >
    {path.map(({ dimension, value }, index) => (
      <React.Fragment key={`${dimension}-${index}`}>
        {index > 0 && (
          <EuiFlexItem grow={false}>
            <EuiIcon type="sortRight" size="s" color="subdued" />
          </EuiFlexItem>
        )}
        <EuiFlexItem grow={false}>
          <EuiBadge
            color={index === path.length - 1 ? 'hollow' : 'default'}
            title={index === path.length - 1 ? lastLabel : `${dimension} = ${value}`}
          >
            {index === path.length - 1 ? lastLabel : `${dimension} = ${truncateValue(value)}`}
          </EuiBadge>
        </EuiFlexItem>
      </React.Fragment>
    ))}
  </EuiFlexGroup>
);

const FindingPanel = ({
  finding,
  selectedBy,
  onOpenQuery,
  onShowDocuments,
  onInvestigateDeeper,
}: {
  finding: InvestigationFinding;
  selectedBy: SelectionInvestigationResult['findingsSelectedBy'];
  onOpenQuery: (finding: InvestigationFinding) => void;
  onShowDocuments: (finding: InvestigationFinding) => void;
  onInvestigateDeeper: (finding: InvestigationFinding) => void;
}) => {
  const formatCount = (value: number) => new Intl.NumberFormat().format(value);
  const changePrefix = finding.direction === 'new' || finding.direction === 'increased' ? '+' : '−';
  const dimensionLabel =
    finding.kind === 'pattern'
      ? i18n.translate('discover.investigateSelection.patternLabel', {
          defaultMessage: 'Message pattern',
        })
      : finding.dimension;
  const deeperHint = deeperBlockedHint(finding.deeperInvestigation);

  return (
    <EuiPanel hasBorder paddingSize="m" data-test-subj="discoverInvestigationFinding">
      <InvestigationPath path={finding.investigationPath} lastLabel={dimensionLabel} />
      <EuiSpacer size="s" />
      <EuiTitle size="xs">
        <h3>{findingClaim(finding)}</h3>
      </EuiTitle>
      <EuiSpacer size="s" />
      <EuiBadge color={triageColor(finding.triage.priority)}>
        {triageTitle(finding.triage.priority)}
      </EuiBadge>
      <EuiSpacer size="xs" />
      <EuiText size="xs" color="subdued">
        <p>
          {triageSummary({
            priority: finding.triage.priority,
            absoluteChange: finding.absoluteChange,
            pathLength: finding.investigationPath.length,
            selectedBy,
          })}
        </p>
        <p>{finding.triage.signals.map(triageSignalLabel).join(' · ')}</p>
        <p>
          {i18n.translate('discover.investigateSelection.triage.nextStep', {
            defaultMessage: 'Recommended next step: {action}',
            values: { action: triageActionLabel(finding.triage.nextAction) },
          })}
        </p>
      </EuiText>
      <EuiSpacer size="s" />
      <EuiText size="s">
        {patternDescription(finding.patternTokens) ? (
          <p>{patternDescription(finding.patternTokens)}</p>
        ) : (
          <p
            title={finding.value}
            css={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            <code>{finding.value}</code>
          </p>
        )}
      </EuiText>
      <EuiSpacer size="m" />
      <EuiFlexGroup gutterSize="m" responsive={false}>
        <EuiFlexItem>
          <EuiText size="xs" color="subdued">
            {i18n.translate('discover.investigateSelection.metric.selection', {
              defaultMessage: 'Selected period',
            })}
          </EuiText>
          <EuiText size="s">
            <strong>{formatCount(finding.selectionCount)}</strong>
          </EuiText>
        </EuiFlexItem>
        <EuiFlexItem>
          <EuiText size="xs" color="subdued">
            {i18n.translate('discover.investigateSelection.metric.baseline', {
              defaultMessage: 'Previous period',
            })}
          </EuiText>
          <EuiText size="s">
            <strong>{formatCount(finding.baselineCount)}</strong>
          </EuiText>
        </EuiFlexItem>
        <EuiFlexItem>
          <EuiText size="xs" color="subdued">
            {i18n.translate('discover.investigateSelection.metric.change', {
              defaultMessage: 'Change',
            })}
          </EuiText>
          <EuiText size="s">
            <strong>
              {changePrefix}
              {formatCount(finding.absoluteChange)}
            </strong>
          </EuiText>
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer size="m" />
      <EuiText size="xs" color="subdued">
        <p>{findingCaveat()}</p>
      </EuiText>
      <EuiSpacer size="s" />
      <EuiAccordion
        id={`discoverInvestigationEvidence-${finding.id}`}
        buttonContent={i18n.translate('discover.investigateSelection.viewEvidence', {
          defaultMessage: 'View evidence',
        })}
        paddingSize="s"
      >
        <EuiText size="xs" color="subdued">
          {i18n.translate('discover.investigateSelection.findingCounts', {
            defaultMessage:
              '{selectionCount} in selection; {baselineCount} in baseline; absolute change {absoluteChange}',
            values: {
              selectionCount: finding.selectionCount,
              baselineCount: finding.baselineCount,
              absoluteChange: finding.absoluteChange,
            },
          })}
          {finding.relativeChange !== null && ` (${Math.round(finding.relativeChange * 100)}%)`}
          {finding.kind !== 'volume' &&
            ` · ${i18n.translate('discover.investigateSelection.findingChangeShare', {
              defaultMessage: '{share}% of the observed change mass in this check',
              values: { share: Math.round(finding.candidateShare * 100) },
            })}`}
          <br />
          {i18n.translate('discover.investigateSelection.findingFilterCount', {
            defaultMessage: '{filterCount, plural, one {# frozen filter} other {# frozen filters}}',
            values: { filterCount: finding.filterCount },
          })}
          <br />
          {i18n.translate('discover.investigateSelection.findingPeriods', {
            defaultMessage:
              'Selection {selectionFrom} – {selectionTo}; baseline {baselineFrom} – {baselineTo}',
            values: {
              selectionFrom: finding.selection.from,
              selectionTo: finding.selection.to,
              baselineFrom: finding.baseline.from,
              baselineTo: finding.baseline.to,
            },
          })}
        </EuiText>
        <EuiSpacer size="s" />
        <EuiCodeBlock language="esql" paddingSize="s" fontSize="s" overflowHeight={120}>
          {finding.query}
        </EuiCodeBlock>
        <EuiSpacer size="s" />
        <EuiBasicTable
          items={finding.preview}
          columns={[
            {
              field: 'key',
              name: i18n.translate('discover.investigateSelection.preview.key', {
                defaultMessage: 'Value',
              }),
              truncateText: true,
            },
            {
              field: 'selectionCount',
              name: i18n.translate('discover.investigateSelection.preview.selection', {
                defaultMessage: 'Selection',
              }),
              dataType: 'number',
            },
            {
              field: 'baselineCount',
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
      <EuiSpacer size="s" />
      <EuiFlexGroup gutterSize="s" responsive={false} wrap>
        {finding.deeperInvestigation === 'available' && (
          <EuiFlexItem grow={false}>
            <EuiButtonEmpty
              size="s"
              iconType="inspect"
              onClick={() => onInvestigateDeeper(finding)}
              data-test-subj="discoverInvestigationDeeper"
            >
              {i18n.translate('discover.investigateSelection.investigateDeeper', {
                defaultMessage: 'Investigate deeper here',
              })}
            </EuiButtonEmpty>
          </EuiFlexItem>
        )}
        <EuiFlexItem grow={false}>
          <EuiButtonEmpty
            size="s"
            iconType="popout"
            onClick={() => onOpenQuery(finding)}
            data-test-subj="discoverInvestigationOpenQuery"
          >
            {i18n.translate('discover.investigateSelection.openQuery', {
              defaultMessage: 'Open in new tab',
            })}
          </EuiButtonEmpty>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiButtonEmpty
            size="s"
            iconType="documents"
            onClick={() => onShowDocuments(finding)}
            data-test-subj="discoverInvestigationShowDocuments"
          >
            {i18n.translate('discover.investigateSelection.showDocuments', {
              defaultMessage: 'Show documents',
            })}
          </EuiButtonEmpty>
        </EuiFlexItem>
      </EuiFlexGroup>
      {deeperHint && (
        <>
          <EuiSpacer size="s" />
          <EuiCallOut
            size="s"
            color="warning"
            iconType="warning"
            title={deeperHint}
            data-test-subj="discoverInvestigationDeeperBlocked"
          />
        </>
      )}
    </EuiPanel>
  );
};

const TriagePanel = ({
  triage,
  finding,
  selectedBy,
  onAction,
}: {
  triage: InvestigationTriage;
  finding?: InvestigationFinding;
  selectedBy: SelectionInvestigationResult['findingsSelectedBy'];
  onAction: (triage: InvestigationTriage) => void;
}) => {
  const color = triageColor(triage.priority);

  return (
    <EuiCallOut
      announceOnMount
      color={color}
      iconType={triage.priority === 'investigate_now' ? 'warning' : 'inspect'}
      title={triageTitle(triage.priority)}
      data-test-subj="discoverInvestigationTriage"
    >
      <p>
        {triageSummary({
          priority: triage.priority,
          absoluteChange: finding?.absoluteChange ?? 0,
          pathLength: finding?.investigationPath.length ?? 1,
          selectedBy,
        })}
      </p>
      <ul>
        {triage.signals.map((code) => (
          <li key={code}>{triageSignalLabel(code)}</li>
        ))}
      </ul>
      <EuiSpacer size="s" />
      <EuiButton
        size="s"
        color={color}
        onClick={() => onAction(triage)}
        data-test-subj="discoverInvestigationTriageAction"
      >
        {triageActionLabel(triage.nextAction)}
      </EuiButton>
    </EuiCallOut>
  );
};

const stepLabel = ({ phase, field, scope }: InvestigationProgressStep): string => {
  const scopeLabel = scope ? `${scope.field} = ${truncateValue(scope.value)}` : undefined;

  switch (phase) {
    case 'total':
      return i18n.translate('discover.investigateSelection.step.total', {
        defaultMessage: 'Comparing the selected period with the previous one',
      });
    case 'planning':
      return i18n.translate('discover.investigateSelection.step.planning', {
        defaultMessage: 'Choosing where to look',
      });
    case 'contributors':
      return scopeLabel
        ? i18n.translate('discover.investigateSelection.step.contributorsScoped', {
            defaultMessage: 'Comparing by {field} within {scope}',
            values: { field, scope: scopeLabel },
          })
        : i18n.translate('discover.investigateSelection.step.contributors', {
            defaultMessage: 'Comparing by {field}',
            values: { field },
          });
    case 'patterns':
      return scopeLabel
        ? i18n.translate('discover.investigateSelection.step.patternsScoped', {
            defaultMessage: 'Comparing message patterns within {scope}',
            values: { scope: scopeLabel },
          })
        : i18n.translate('discover.investigateSelection.step.patterns', {
            defaultMessage: 'Comparing message patterns',
          });
  }
};

/**
 * Once every reported step has finished but the run has not, the agent is composing its answer and
 * the server is validating it. Neither emits an event, so the closing row is derived from the fact
 * that nothing is in progress — which also keeps it last by construction.
 */
const isDrawingConclusions = (steps: InvestigationProgressStep[], isRunning: boolean) =>
  isRunning && steps.length > 0 && steps.every(({ status }) => status !== 'start');

const InvestigationTimeline = ({
  steps,
  isRunning = false,
}: {
  steps: InvestigationProgressStep[];
  isRunning?: boolean;
}) => (
  <EuiFlexGroup
    direction="column"
    gutterSize="s"
    responsive={false}
    data-test-subj="discoverInvestigationTimeline"
  >
    {steps.map((step) => (
      <EuiFlexItem key={step.stepId} grow={false}>
        <EuiFlexGroup gutterSize="s" alignItems="flexStart" responsive={false}>
          <EuiFlexItem grow={false}>
            {step.status === 'start' ? (
              <EuiLoadingSpinner size="m" />
            ) : (
              <EuiIcon
                type={step.status === 'success' ? 'check' : 'cross'}
                color={step.status === 'success' ? 'success' : 'danger'}
              />
            )}
          </EuiFlexItem>
          <EuiFlexItem>
            <EuiText size="s" color={step.status === 'start' ? 'default' : 'subdued'}>
              {stepLabel(step)}
            </EuiText>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiFlexItem>
    ))}
    {isDrawingConclusions(steps, isRunning) && (
      <EuiFlexItem grow={false}>
        <EuiFlexGroup gutterSize="s" alignItems="flexStart" responsive={false}>
          <EuiFlexItem grow={false}>
            <EuiLoadingSpinner size="m" />
          </EuiFlexItem>
          <EuiFlexItem>
            <EuiText size="s">
              {i18n.translate('discover.investigateSelection.step.drawingConclusions', {
                defaultMessage: 'Reviewing the evidence and drawing conclusions',
              })}
            </EuiText>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiFlexItem>
    )}
  </EuiFlexGroup>
);

const InvestigationFlyout = ({
  state,
  onClose,
  onStop,
  onRetry,
  onOpenQuery,
  onShowDocuments,
  onTriageAction,
  onInvestigateDeeper,
  onScopeDepthChange,
}: {
  state: InvestigationRuntimeState;
  onClose: () => void;
  onStop: () => void;
  onRetry: () => void;
  onOpenQuery: (finding: InvestigationFinding) => void;
  onShowDocuments: (finding: InvestigationFinding) => void;
  onTriageAction: (triage: InvestigationTriage) => void;
  onInvestigateDeeper: (finding: InvestigationFinding) => void;
  /** Re-runs keeping only the first `depth` scopes. 0 goes back to the whole selection. */
  onScopeDepthChange: (depth: number) => void;
}) => {
  const isRunning = state.status === 'running' && !state.result;

  return (
    <EuiFlyout
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
              defaultMessage: 'Changes in selected period',
            })}
          </h2>
        </EuiTitle>
        {state.request && state.baseline && (
          <EuiText size="xs" color="subdued">
            <p>
              {state.request.selection.from} – {state.request.selection.to}
              <br />
              {i18n.translate('discover.investigateSelection.baselineLabel', {
                defaultMessage: 'Baseline: {from} – {to}',
                values: { from: state.baseline.from, to: state.baseline.to },
              })}
            </p>
          </EuiText>
        )}
        {state.request?.scopes && state.request.scopes.length > 0 && (
          <>
            <EuiSpacer size="xs" />
            <EuiFlexGroup gutterSize="xs" alignItems="center" responsive={false} wrap>
              {state.request.scopes.map(({ field, value, mode }, index) => {
                const isCurrentDepth = index === (state.request?.scopes?.length ?? 0) - 1;
                const label = i18n.translate('discover.investigateSelection.scopedTo', {
                  defaultMessage: '{field} = {value}',
                  values: { field, value: truncateValue(value) },
                });

                return (
                  <EuiFlexItem grow={false} key={`${mode}-${field}-${String(value)}-${index}`}>
                    {isCurrentDepth ? (
                      <EuiBadge color="accent" data-test-subj="discoverInvestigationScopeBadge">
                        {label}
                      </EuiBadge>
                    ) : (
                      <EuiBadge
                        color="accent"
                        data-test-subj="discoverInvestigationScopeBadge"
                        onClick={() => onScopeDepthChange(index + 1)}
                        onClickAriaLabel={i18n.translate(
                          'discover.investigateSelection.backToScope',
                          {
                            defaultMessage: 'Investigate again down to {field}',
                            values: { field },
                          }
                        )}
                      >
                        {label}
                      </EuiBadge>
                    )}
                  </EuiFlexItem>
                );
              })}
              <EuiFlexItem grow={false}>
                <EuiButtonEmpty size="xs" iconType="cross" onClick={() => onScopeDepthChange(0)}>
                  {i18n.translate('discover.investigateSelection.clearScope', {
                    defaultMessage: 'Clear scope',
                  })}
                </EuiButtonEmpty>
              </EuiFlexItem>
            </EuiFlexGroup>
          </>
        )}
      </EuiFlyoutHeader>
      <EuiFlyoutBody>
        {isRunning && (
          <>
            <EuiFlexGroup direction="column" gutterSize="s" alignItems="center" responsive={false}>
              <EuiFlexItem grow={false}>
                <InvestigationPulse size={64} />
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <EuiText size="s">
                  <strong>
                    {i18n.translate('discover.investigateSelection.runningTitle', {
                      defaultMessage: 'Finding what changed…',
                    })}
                  </strong>
                </EuiText>
              </EuiFlexItem>
              {/* Directional motion the illustration cannot give: this is what reads as "working". */}
              <EuiFlexItem grow={false} css={{ inlineSize: 180 }}>
                <EuiProgress size="xs" color="primary" />
              </EuiFlexItem>
            </EuiFlexGroup>
            <EuiSpacer size="m" />
            <InvestigationTimeline steps={state.steps} isRunning />
          </>
        )}

        {state.result && (
          <>
            {state.result.outcome === 'changes_found' && (
              <>
                <EuiCallOut
                  announceOnMount
                  color="primary"
                  iconType="search"
                  title={i18n.translate('discover.investigateSelection.changesFound', {
                    defaultMessage:
                      '{count, plural, one {# material change found} other {# material changes found}}',
                    values: { count: state.result.findings.length },
                  })}
                  data-test-subj="discoverInvestigationChangesFound"
                >
                  <p>
                    {i18n.translate('discover.investigateSelection.changesFoundDescription', {
                      defaultMessage:
                        'These are observed changes from the completed checks, ranked by evidence strength and magnitude.',
                    })}
                  </p>
                </EuiCallOut>
                <EuiSpacer size="m" />
                {state.result.findingsSelectedBy === 'server_ranking' && (
                  <>
                    <EuiCallOut
                      size="s"
                      color="warning"
                      iconType="warning"
                      title={serverRankedFindingsMessage()}
                      data-test-subj="discoverInvestigationServerRanked"
                    />
                    <EuiSpacer size="m" />
                  </>
                )}
                {state.result.triage && (
                  <>
                    <TriagePanel
                      triage={state.result.triage}
                      finding={state.result.findings.find(
                        ({ id }) => id === state.result?.triage?.findingId
                      )}
                      selectedBy={state.result.findingsSelectedBy}
                      onAction={onTriageAction}
                    />
                    <EuiSpacer size="m" />
                  </>
                )}
              </>
            )}
            {state.result.outcome === 'unexplained_change' && (
              <EuiCallOut
                announceOnMount
                color="primary"
                iconType="questionInCircle"
                data-test-subj="discoverInvestigationUnexplainedChange"
              >
                <p>{unexplainedChangeMessage()}</p>
              </EuiCallOut>
            )}
            {state.result.outcome === 'no_material_change' && (
              <EuiCallOut announceOnMount color="success" iconType="check">
                <p>{noMaterialChangeMessage()}</p>
              </EuiCallOut>
            )}
            {state.result.outcome === 'insufficient_evidence' && (
              <EuiCallOut announceOnMount color="warning" iconType="warning">
                <p>
                  {(state.result.insufficientEvidenceReason
                    ? coverageIssueMessage(state.result.insufficientEvidenceReason)
                    : undefined) ??
                    i18n.translate('discover.investigateSelection.insufficientEvidence', {
                      defaultMessage:
                        'The bounded checks did not produce enough consistent evidence for a finding.',
                    })}
                </p>
              </EuiCallOut>
            )}
            {state.result.findings.map((finding) => (
              <React.Fragment key={finding.id}>
                <FindingPanel
                  finding={finding}
                  selectedBy={state.result?.findingsSelectedBy}
                  onOpenQuery={onOpenQuery}
                  onShowDocuments={onShowDocuments}
                  onInvestigateDeeper={onInvestigateDeeper}
                />
                <EuiSpacer size="m" />
              </React.Fragment>
            ))}
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
          <EuiCallOut announceOnMount color="danger" iconType="error">
            <p>
              {i18n.translate('discover.investigateSelection.error', {
                defaultMessage: 'The investigation could not be completed ({code}): {message}',
                values: {
                  code: state.errorCode ?? 'execution_failed',
                  message: state.errorMessage ?? 'Unknown Agent Builder error',
                },
              })}
            </p>
          </EuiCallOut>
        )}
        {!isRunning && state.steps.length > 0 && (
          <>
            <EuiSpacer size="m" />
            <EuiAccordion
              id="discoverInvestigationTimeline"
              buttonContent={i18n.translate('discover.investigateSelection.timelineTitle', {
                defaultMessage:
                  'What the agent did ({count, plural, one {# step} other {# steps}})',
                values: { count: state.steps.length },
              })}
              paddingSize="s"
              data-test-subj="discoverInvestigationTimelineAccordion"
            >
              <InvestigationTimeline steps={state.steps} />
            </EuiAccordion>
          </>
        )}
      </EuiFlyoutBody>
      <EuiFlyoutFooter>
        <EuiFlexGroup justifyContent="spaceBetween" responsive={false}>
          <EuiFlexItem grow={false}>
            <EuiButtonEmpty onClick={onClose}>
              {i18n.translate('discover.investigateSelection.hide', {
                defaultMessage: 'Hide',
              })}
            </EuiButtonEmpty>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            {state.status === 'running' ? (
              <EuiButton color="danger" onClick={onStop}>
                {i18n.translate('discover.investigateSelection.stop', {
                  defaultMessage: 'Stop',
                })}
              </EuiButton>
            ) : (
              <EuiButton
                fill
                onClick={onRetry}
                disabled={!state.request}
                data-test-subj="discoverInvestigationRetry"
              >
                {i18n.translate('discover.investigateSelection.retry', {
                  defaultMessage: 'Retry',
                })}
              </EuiButton>
            )}
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiFlyoutFooter>
    </EuiFlyout>
  );
};

export const SelectionInvestigationProvider = ({ children }: PropsWithChildren): JSX.Element => {
  const services = useDiscoverServices();
  const dispatch = useInternalStateDispatch();
  const currentTabId = useInternalStateSelector(
    (internalState) => internalState.tabs.unsafeCurrentId
  );
  const allTabIds = useInternalStateSelector((internalState) => internalState.tabs.allIds);
  const canInvestigate = Boolean(services.agentBuilder);
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const [state, setState] = useState<InvestigationRuntimeState>(initialState);
  const abortControllerRef = useRef<AbortController>();
  const subscriptionRef = useRef<Subscription>();
  const lastBrushContextRef = useRef<InvestigationBrushContext>();
  const [instanceId, setInstanceId] = useState<string>();

  const stop = useCallback(() => {
    abortControllerRef.current?.abort();
    subscriptionRef.current?.unsubscribe();
    services.trackUiMetric?.(METRIC_TYPE.CLICK, TELEMETRY_EVENT.stopped);
    setState((current) => ({ ...current, status: 'aborted' }));
  }, [services]);

  useEffect(
    () => () => {
      abortControllerRef.current?.abort();
      subscriptionRef.current?.unsubscribe();
    },
    []
  );

  useEffect(() => {
    if (state.tabId && !allTabIds.includes(state.tabId)) {
      abortControllerRef.current?.abort();
      subscriptionRef.current?.unsubscribe();
      setFlyoutOpen(false);
      setState(initialState);
    }
  }, [allTabIds, state.tabId]);

  const openQuery = useCallback(
    (finding: InvestigationFinding) => {
      if (!state.request || !state.baseline) {
        return;
      }
      void dispatch(
        internalStateActions.openInNewTabExtPointAction({
          query: { esql: finding.query },
          tabLabel: i18n.translate('discover.investigateSelection.queryTabLabel', {
            defaultMessage: 'Investigation evidence',
          }),
          timeRange: {
            from: state.baseline.from,
            to: state.request.selection.to,
          },
        })
      );
    },
    [dispatch, state.baseline, state.request]
  );

  const showDocuments = useCallback(
    (finding: InvestigationFinding) => {
      if (!state.request || !state.baseline || !state.tabId) {
        return;
      }
      const timeRange =
        finding.documentsTimeScope === 'selection' ? state.request.selection : state.baseline;
      dispatch(
        internalStateActions.updateESQLQuery({
          tabId: state.tabId,
          queryOrUpdater: finding.documentsQuery,
        })
      );
      dispatch(
        internalStateActions.updateGlobalState({
          tabId: state.tabId,
          globalState: { timeRange },
        })
      );
    },
    [dispatch, state.baseline, state.request, state.tabId]
  );

  const runTriageAction = useCallback(
    (triage: InvestigationTriage) => {
      const finding = state.result?.findings.find(({ id }) => id === triage.findingId);
      if (!finding) {
        return;
      }
      if (triage.nextAction === 'show_documents') {
        showDocuments(finding);
      } else {
        openQuery(finding);
      }
    },
    [openQuery, showDocuments, state.result]
  );

  // Runs an already-built request. Re-runs (retry, drill down, clear scopes) go through here with
  // the request the flyout is showing, so they can never pick up a range the user brushed later.
  const runRequest = useCallback(
    (request: SelectionInvestigationRequest, tabId: string) => {
      abortControllerRef.current?.abort();
      subscriptionRef.current?.unsubscribe();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const depth = request.scopes?.length ?? 0;
      setState((current) => ({
        status: 'running',
        request,
        tabId,
        steps: [],
        history: current.history.slice(0, depth),
      }));
      setFlyoutOpen(true);
      services.trackUiMetric?.(METRIC_TYPE.COUNT, TELEMETRY_EVENT.started);

      let terminalReceived = false;
      subscriptionRef.current = defer(() =>
        services.http.post(SELECTION_INVESTIGATION_ROUTE, {
          body: JSON.stringify(request),
          asResponse: true,
          rawResponse: true,
          signal: controller.signal,
        })
      )
        .pipe(httpResponseIntoObservable<SelectionInvestigationSseEvent>())
        .subscribe({
          next: (event) => {
            if (event.type === 'started') {
              // The server owns how the previous period is derived; take it from the wire rather
              // than recomputing it here, so the two can never disagree.
              setState((current) => ({ ...current, baseline: event.data.baseline }));
            } else if (event.type === 'phase') {
              setState((current) => {
                const existing = current.steps.findIndex(
                  ({ stepId }) => stepId === event.data.stepId
                );
                return {
                  ...current,
                  steps:
                    existing === -1
                      ? [...current.steps, event.data]
                      : current.steps.map((step, index) =>
                          index === existing ? event.data : step
                        ),
                };
              });
            } else if (event.type === 'completed') {
              terminalReceived = true;
              services.trackUiMetric?.(
                METRIC_TYPE.LOADED,
                TELEMETRY_EVENT.outcome(event.data.outcome)
              );
              setState((current) => {
                const history = [...current.history];
                history[depth] = {
                  request,
                  baseline: current.baseline,
                  steps: current.steps,
                  result: event.data,
                };

                return { ...current, status: 'completed', result: event.data, history };
              });
            } else if (event.type === 'aborted') {
              terminalReceived = true;
              services.trackUiMetric?.(METRIC_TYPE.COUNT, TELEMETRY_EVENT.aborted);
              setState((current) => ({ ...current, status: 'aborted' }));
            } else if (event.type === 'investigation_error') {
              terminalReceived = true;
              services.trackUiMetric?.(METRIC_TYPE.COUNT, TELEMETRY_EVENT.error);
              setState((current) => ({
                ...current,
                status: 'error',
                errorCode: event.data.code,
                errorMessage: event.data.message,
              }));
            }
          },
          error: (error: Error) => {
            terminalReceived = true;
            if (controller.signal.aborted) {
              setState((current) => ({ ...current, status: 'aborted' }));
            } else {
              services.trackUiMetric?.(METRIC_TYPE.COUNT, TELEMETRY_EVENT.error);
              setState((current) => ({
                ...current,
                status: 'error',
                errorCode: getInvestigationErrorCode(error),
                errorMessage: getInvestigationErrorMessage(error),
              }));
            }
          },
          complete: () => {
            if (!terminalReceived && !controller.signal.aborted) {
              services.trackUiMetric?.(METRIC_TYPE.COUNT, TELEMETRY_EVENT.error);
              setState((current) => ({
                ...current,
                status: 'error',
                errorCode: 'execution_failed',
              }));
            }
          },
        });
    },
    [services]
  );

  const start = useCallback(
    (brushContext: InvestigationBrushContext) => {
      const [fromMs, toMs] = brushContext.range;
      runRequest(
        {
          requestId: uuidv4(),
          query: brushContext.query,
          timeField: brushContext.timeField,
          selection: {
            from: new Date(Math.min(fromMs, toMs)).toISOString(),
            to: new Date(Math.max(fromMs, toMs)).toISOString(),
          },
          filters: brushContext.filters,
          variables: Object.fromEntries(
            brushContext.variables.map((variable) => [variable.key, variable])
          ),
        },
        brushContext.tabId
      );
    },
    [runRequest]
  );

  // Re-runs derive from the request currently on screen, only swapping the scopes and the id.
  const rerunWithScopes = useCallback(
    (scopes: InvestigationScope[]) => {
      if (!state.request || !state.tabId) {
        return;
      }
      const { scopes: _previousScopes, ...request } = state.request;
      runRequest(
        { ...request, requestId: uuidv4(), ...(scopes.length > 0 ? { scopes } : {}) },
        state.tabId
      );
    },
    [runRequest, state.request, state.tabId]
  );

  const retry = useCallback(
    () => rerunWithScopes(state.request?.scopes ?? []),
    [rerunWithScopes, state.request?.scopes]
  );

  const investigateDeeper = useCallback(
    (finding: InvestigationFinding) => {
      services.trackUiMetric?.(METRIC_TYPE.CLICK, TELEMETRY_EVENT.deeper);
      rerunWithScopes(finding.scopes);
    },
    [rerunWithScopes, services]
  );

  const goToScopeDepth = useCallback(
    (depth: number) => {
      const recorded = state.history[depth];
      if (!recorded) {
        rerunWithScopes((state.request?.scopes ?? []).slice(0, depth));
        return;
      }
      abortControllerRef.current?.abort();
      subscriptionRef.current?.unsubscribe();
      setState((current) => ({
        ...current,
        status: 'completed',
        request: recorded.request,
        baseline: recorded.baseline,
        steps: recorded.steps,
        result: recorded.result,
        errorCode: undefined,
        errorMessage: undefined,
      }));
    },
    [rerunWithScopes, state.history, state.request?.scopes]
  );

  // Registered per mount and torn down with it, so several Discover tabs can each offer their own
  // actions. `instanceId` is what keeps one tab's menu from answering for another's.
  useEffect(() => {
    const currentInstanceId = uuidv4();
    const actions = createSelectionBrushActions({
      instanceId: currentInstanceId,
      canInvestigate,
      onInvestigate: () => {
        if (lastBrushContextRef.current) {
          start(lastBrushContextRef.current);
        }
      },
    });

    actions.forEach((action) => {
      services.uiActions.registerActionAsync(action.id, async () => action);
      services.uiActions.attachAction(DISCOVER_SELECTION_ACTIONS_TRIGGER_ID, action.id);
    });
    setInstanceId(currentInstanceId);

    return () => {
      actions.forEach((action) => {
        services.uiActions.detachAction(DISCOVER_SELECTION_ACTIONS_TRIGGER_ID, action.id);
        services.uiActions.unregisterAction(action.id);
      });
      setInstanceId(undefined);
    };
  }, [canInvestigate, services, start]);

  const handleBrush = useCallback(
    (brushContext: InvestigationBrushContext) => {
      if (brushContext.range.length < 2 || !instanceId) {
        brushContext.applySelection();
        return;
      }
      lastBrushContextRef.current = brushContext;
      void services.uiActions.executeTriggerActions(DISCOVER_SELECTION_ACTIONS_TRIGGER_ID, {
        instanceId,
        applySelection: brushContext.applySelection,
      });
    },
    [instanceId, services]
  );

  const value = useMemo(
    () => ({
      canInvestigate,
      handleBrush,
      investigationTabId: state.tabId,
      isFlyoutOpen: flyoutOpen,
      showInvestigation: () => setFlyoutOpen(true),
    }),
    [canInvestigate, flyoutOpen, handleBrush, state.tabId]
  );

  return (
    <SelectionInvestigationContext.Provider value={value}>
      {children}
      {flyoutOpen && state.tabId === currentTabId && (
        <InvestigationFlyout
          state={state}
          onClose={() => setFlyoutOpen(false)}
          onStop={stop}
          onRetry={retry}
          onOpenQuery={openQuery}
          onShowDocuments={showDocuments}
          onTriageAction={runTriageAction}
          onInvestigateDeeper={investigateDeeper}
          onScopeDepthChange={goToScopeDepth}
        />
      )}
    </SelectionInvestigationContext.Provider>
  );
};

export const useSelectionInvestigation = (): SelectionInvestigationContextValue =>
  useContext(SelectionInvestigationContext);
