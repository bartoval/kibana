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
import { i18n } from '@kbn/i18n';
import { DISCOVER_SELECTION_ACTIONS_TRIGGER_ID } from '@kbn/ui-actions-plugin/common/trigger_ids';
import { METRIC_TYPE } from '@kbn/analytics';
import { defer, type Subscription } from 'rxjs';
import { httpResponseIntoObservable } from '@kbn/sse-utils-client';
import type { ESQLControlVariable } from '@kbn/esql-types';
import type {
  InvestigationFinding,
  InvestigationFollowUp,
  SelectionInvestigationRequest,
  SelectionInvestigationSseEvent,
} from '../../../../../common/selection_investigation';
import { SELECTION_INVESTIGATION_ROUTE } from '../../../../../common/selection_investigation';
import { useDiscoverServices } from '../../../../hooks/use_discover_services';
import { useInternalStateSelector } from '../../state_management/redux';
import { createSelectionBrushActions } from './selection_brush_actions';
import { InvestigationFlyout } from './selection_investigation/investigation_flyout';
import { InvestigationLauncher } from './selection_investigation/investigation_launcher';
import type {
  InvestigationFlyoutState,
  InvestigationLauncherContext,
} from './selection_investigation/types';

interface InvestigationBrushContext extends InvestigationLauncherContext {
  tabId: string;
  timeField: string;
  variables: ESQLControlVariable[];
  applySelection: () => void;
}

interface InvestigationRuntimeState extends InvestigationFlyoutState {
  // Which Discover tab the investigation belongs to. Local only: the server never needs it.
  tabId?: string;
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
  completed: 'discover_selection_investigation_completed',
  deeper: 'discover_selection_investigation_deeper',
} as const;

const initialState: InvestigationRuntimeState = {
  status: 'idle',
  steps: [],
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

export const SelectionInvestigationProvider = ({ children }: PropsWithChildren): JSX.Element => {
  const services = useDiscoverServices();
  const currentTabId = useInternalStateSelector(
    (internalState) => internalState.tabs.unsafeCurrentId
  );
  const allTabIds = useInternalStateSelector((internalState) => internalState.tabs.allIds);
  const canInvestigate = Boolean(services.agentBuilder);
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const [state, setState] = useState<InvestigationRuntimeState>(initialState);
  const [launcherContext, setLauncherContext] = useState<InvestigationBrushContext>();
  const [draftGoal, setDraftGoal] = useState('');
  const abortControllerRef = useRef<AbortController>();
  const subscriptionRef = useRef<Subscription>();
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
    if (launcherContext?.tabId && !allTabIds.includes(launcherContext.tabId)) {
      setLauncherContext(undefined);
      setDraftGoal('');
    }
  }, [allTabIds, launcherContext?.tabId, state.tabId]);

  useEffect(() => {
    if (launcherContext && launcherContext.tabId !== currentTabId) {
      setLauncherContext(undefined);
      setDraftGoal('');
    }
  }, [currentTabId, launcherContext]);

  // Re-runs use the frozen request shown in the flyout, so they cannot pick up a later brush range.
  const runRequest = useCallback(
    (request: SelectionInvestigationRequest, tabId: string) => {
      abortControllerRef.current?.abort();
      subscriptionRef.current?.unsubscribe();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setState({
        status: 'running',
        request,
        tabId,
        steps: [],
      });
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
              services.trackUiMetric?.(METRIC_TYPE.LOADED, TELEMETRY_EVENT.completed);
              setState((current) => ({
                ...current,
                status: 'completed',
                result: event.data,
              }));
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
    (brushContext: InvestigationBrushContext, goal: string) => {
      const [fromMs, toMs] = brushContext.range;
      runRequest(
        {
          requestId: uuidv4(),
          goal: goal.trim(),
          query: brushContext.query,
          timeField: brushContext.timeField,
          selection: {
            from: new Date(Math.min(fromMs, toMs)).toISOString(),
            to: new Date(Math.max(fromMs, toMs)).toISOString(),
          },
          filters: brushContext.filters,
          variables: brushContext.variables.map(({ key, value, type }) => ({ key, value, type })),
        },
        brushContext.tabId
      );
    },
    [runRequest]
  );

  const retry = useCallback(() => {
    if (state.request && state.tabId) {
      runRequest({ ...state.request, requestId: uuidv4() }, state.tabId);
    }
  }, [runRequest, state.request, state.tabId]);

  const investigateAnotherQuestion = useCallback(() => {
    if (!state.request || !state.tabId) {
      return;
    }
    setLauncherContext({
      range: [
        new Date(state.request.selection.from).getTime(),
        new Date(state.request.selection.to).getTime(),
      ],
      tabId: state.tabId,
      query: state.request.query,
      timeField: state.request.timeField,
      filters: state.request.filters,
      variables: state.request.variables,
      applySelection: () => undefined,
    });
    setDraftGoal('');
    setFlyoutOpen(false);
  }, [state.request, state.tabId]);

  const investigateFollowUp = useCallback(
    (followUp: InvestigationFollowUp) => {
      if (!state.request || !state.tabId) {
        return;
      }
      runRequest(
        {
          ...state.request,
          requestId: uuidv4(),
          goal: followUp.goal,
        },
        state.tabId
      );
    },
    [runRequest, state.request, state.tabId]
  );

  const goDeeper = useCallback(
    (finding: InvestigationFinding) => {
      if (!state.request || !state.tabId) {
        return;
      }
      services.trackUiMetric?.(METRIC_TYPE.CLICK, TELEMETRY_EVENT.deeper);
      runRequest(
        {
          ...state.request,
          requestId: uuidv4(),
          goal: i18n.translate('discover.investigateSelection.deeperGoal', {
            defaultMessage: 'Go deeper into: {title}',
            values: { title: finding.title },
          }),
          focus: {
            title: finding.title,
            summary: finding.summary,
            kind: finding.kind,
            dimension: finding.dimension,
            value: finding.value,
            selectionValue: finding.selectionValue,
            baselineValue: finding.baselineValue,
            query: finding.query,
          },
        },
        state.tabId
      );
    },
    [runRequest, services, state.request, state.tabId]
  );

  // Registered per mount and torn down with it, so several Discover tabs can each offer their own
  // actions. `instanceId` is what keeps one tab's menu from answering for another's.
  useEffect(() => {
    const currentInstanceId = uuidv4();
    const actions = createSelectionBrushActions({
      instanceId: currentInstanceId,
      canInvestigate,
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
  }, [canInvestigate, services]);

  const handleBrush = useCallback(
    (brushContext: InvestigationBrushContext) => {
      if (brushContext.range.length < 2 || !instanceId) {
        brushContext.applySelection();
        return;
      }
      void services.uiActions.executeTriggerActions(DISCOVER_SELECTION_ACTIONS_TRIGGER_ID, {
        instanceId,
        applySelection: brushContext.applySelection,
        openInvestigation: () => {
          setLauncherContext(brushContext);
          setDraftGoal('');
        },
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
      {launcherContext && launcherContext.tabId === currentTabId && (
        <InvestigationLauncher
          context={launcherContext}
          goal={draftGoal}
          onGoalChange={setDraftGoal}
          onClose={() => {
            setLauncherContext(undefined);
            setDraftGoal('');
          }}
          onStart={() => {
            const context = launcherContext;
            const goal = draftGoal.trim();
            if (!goal) {
              return;
            }
            setLauncherContext(undefined);
            setDraftGoal('');
            start(context, goal);
          }}
        />
      )}
      {flyoutOpen && state.tabId === currentTabId && (
        <InvestigationFlyout
          state={state}
          onClose={() => setFlyoutOpen(false)}
          onStop={stop}
          onRetry={retry}
          onInvestigateAnotherQuestion={investigateAnotherQuestion}
          onInvestigateFollowUp={investigateFollowUp}
          onGoDeeper={goDeeper}
        />
      )}
    </SelectionInvestigationContext.Provider>
  );
};

export const useSelectionInvestigation = (): SelectionInvestigationContextValue =>
  useContext(SelectionInvestigationContext);
