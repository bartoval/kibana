/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { ControlGroupApi } from '@kbn/controls-plugin/public';
import {
  GlobalQueryStateFromUrl,
  RefreshInterval,
  connectToQueryState,
  syncGlobalQueryStateWithUrl,
} from '@kbn/data-plugin/public';
import {
  COMPARE_ALL_OPTIONS,
  Filter,
  Query,
  TimeRange,
  compareFilters,
  isFilterPinned,
} from '@kbn/es-query';
import { ESQLControlVariable } from '@kbn/esql-types';
import { PublishingSubject, StateComparators, diffComparators } from '@kbn/presentation-publishing';
import fastIsEqual from 'fast-deep-equal';
import { cloneDeep } from 'lodash';
import moment, { Moment } from 'moment';
import {
  BehaviorSubject,
  Observable,
  Subject,
  Subscription,
  combineLatest,
  combineLatestWith,
  debounceTime,
  distinctUntilChanged,
  finalize,
  map,
  of,
  switchMap,
  tap,
} from 'rxjs';
import { dataService } from '../services/kibana_services';
import { GLOBAL_STATE_STORAGE_KEY } from '../utils/urls';
import { DEFAULT_DASHBOARD_STATE } from './default_dashboard_state';
import { DashboardCreationOptions } from './types';
import { DashboardState, cleanFiltersForSerialize } from '../../common';

export function initializeUnifiedSearchManager(
  initialState: DashboardState,
  controlGroupApi$: PublishingSubject<ControlGroupApi | undefined>,
  timeRestore$: PublishingSubject<boolean | undefined>,
  waitForPanelsToLoad$: Observable<void>,
  getLastSavedState: () => DashboardState | undefined,
  creationOptions?: DashboardCreationOptions
) {
  const {
    queryString,
    filterManager,
    timefilter: { timefilter: timefilterService },
  } = dataService.query;

  const controlGroupReload$ = new Subject<void>();
  const filters$ = new BehaviorSubject<Filter[] | undefined>(undefined);
  const panelsReload$ = new Subject<void>();
  const query$ = new BehaviorSubject<Query | undefined>(initialState.query);
  // setAndSyncQuery method not needed since query synced with 2-way data binding
  function setQuery(query: Query) {
    if (!fastIsEqual(query, query$.value)) {
      query$.next(query);
    }
  }
  const refreshInterval$ = new BehaviorSubject<RefreshInterval | undefined>(
    initialState.refreshInterval
  );
  function setRefreshInterval(refreshInterval: RefreshInterval) {
    if (!fastIsEqual(refreshInterval, refreshInterval$.value)) {
      refreshInterval$.next(refreshInterval);
    }
  }
  function setAndSyncRefreshInterval(refreshInterval: RefreshInterval | undefined) {
    const refreshIntervalOrDefault =
      refreshInterval ?? timefilterService.getRefreshIntervalDefaults();
    setRefreshInterval(refreshIntervalOrDefault);
    if (creationOptions?.useUnifiedSearchIntegration) {
      timefilterService.setRefreshInterval(refreshIntervalOrDefault);
    }
  }
  const timeRange$ = new BehaviorSubject<TimeRange | undefined>(initialState.timeRange);
  function setTimeRange(timeRange: TimeRange) {
    if (!fastIsEqual(timeRange, timeRange$.value)) {
      timeRange$.next(timeRange);
    }
  }
  function setAndSyncTimeRange(timeRange: TimeRange | undefined) {
    const timeRangeOrDefault = timeRange ?? timefilterService.getTimeDefaults();
    setTimeRange(timeRangeOrDefault);
    if (creationOptions?.useUnifiedSearchIntegration) {
      timefilterService.setTime(timeRangeOrDefault);
    }
  }
  const timeslice$ = new BehaviorSubject<[number, number] | undefined>(undefined);
  const unifiedSearchFilters$ = new BehaviorSubject<Filter[] | undefined>(initialState.filters);
  // setAndSyncUnifiedSearchFilters method not needed since filters synced with 2-way data binding
  function setUnifiedSearchFilters(unifiedSearchFilters: Filter[] | undefined) {
    if (!fastIsEqual(unifiedSearchFilters, unifiedSearchFilters$.value)) {
      unifiedSearchFilters$.next(unifiedSearchFilters);
    }
  }

  // --------------------------------------------------------------------------------------
  // Set up control group integration
  // --------------------------------------------------------------------------------------
  const controlGroupSubscriptions: Subscription = new Subscription();
  const controlGroupFilters$ = controlGroupApi$.pipe(
    switchMap((controlGroupApi) => (controlGroupApi ? controlGroupApi.filters$ : of(undefined)))
  );
  const controlGroupTimeslice$ = controlGroupApi$.pipe(
    switchMap((controlGroupApi) => (controlGroupApi ? controlGroupApi.timeslice$ : of(undefined)))
  );

  // forward ESQL variables from the control group. TODO, this is overcomplicated by the fact that
  // the control group API is a publishing subject. Instead, the control group API should be a constant
  const esqlVariables$ = new BehaviorSubject<ESQLControlVariable[]>([]);
  const controlGroupEsqlVariables$ = controlGroupApi$.pipe(
    switchMap((controlGroupApi) =>
      controlGroupApi ? controlGroupApi.esqlVariables$ : of([] as ESQLControlVariable[])
    )
  );
  controlGroupSubscriptions.add(
    controlGroupEsqlVariables$.subscribe((latestVariables) => esqlVariables$.next(latestVariables))
  );

  controlGroupSubscriptions.add(
    combineLatest([unifiedSearchFilters$, controlGroupFilters$]).subscribe(
      ([unifiedSearchFilters, controlGroupFilters]) => {
        filters$.next([...(unifiedSearchFilters ?? []), ...(controlGroupFilters ?? [])]);
      }
    )
  );
  controlGroupSubscriptions.add(
    controlGroupTimeslice$.subscribe((timeslice) => {
      if (timeslice !== timeslice$.value) timeslice$.next(timeslice);
    })
  );

  // --------------------------------------------------------------------------------------
  // Set up unified search integration.
  // --------------------------------------------------------------------------------------
  const unifiedSearchSubscriptions: Subscription = new Subscription();
  let stopSyncingWithUrl: (() => void) | undefined;
  let stopSyncingAppFilters: (() => void) | undefined;
  if (
    creationOptions?.useUnifiedSearchIntegration &&
    creationOptions?.unifiedSearchSettings?.kbnUrlStateStorage
  ) {
    // apply filters and query to the query service
    filterManager.setAppFilters(cloneDeep(unifiedSearchFilters$.value ?? []));
    queryString.setQuery(query$.value ?? queryString.getDefaultQuery());

    /**
     * Get initial time range, and set up dashboard time restore if applicable
     */
    const initialTimeRange: TimeRange = (() => {
      // if there is an explicit time range in the URL it always takes precedence.
      const urlOverrideTimeRange =
        creationOptions.unifiedSearchSettings.kbnUrlStateStorage.get<GlobalQueryStateFromUrl>(
          GLOBAL_STATE_STORAGE_KEY
        )?.time;
      if (urlOverrideTimeRange) return urlOverrideTimeRange;

      // if this Dashboard has timeRestore return the time range that was saved with the dashboard.
      if (timeRestore$.value && timeRange$.value) return timeRange$.value;

      // otherwise fall back to the time range from the timefilterService.
      return timefilterService.getTime();
    })();
    setTimeRange(initialTimeRange);
    if (timeRestore$.value) {
      if (timeRange$.value) timefilterService.setTime(timeRange$.value);
      if (refreshInterval$.value) timefilterService.setRefreshInterval(refreshInterval$.value);
    }

    // start syncing global query state with the URL.
    const { stop } = syncGlobalQueryStateWithUrl(
      dataService.query,
      creationOptions?.unifiedSearchSettings.kbnUrlStateStorage
    );
    stopSyncingWithUrl = stop;

    stopSyncingAppFilters = connectToQueryState(
      dataService.query,
      {
        get: () => ({
          filters: unifiedSearchFilters$.value ?? [],
          query: query$.value ?? dataService.query.queryString.getDefaultQuery(),
        }),
        set: ({ filters: newFilters, query: newQuery }) => {
          setUnifiedSearchFilters(cleanFiltersForSerialize(newFilters));
          setQuery(newQuery);
        },
        state$: combineLatest([query$, unifiedSearchFilters$]).pipe(
          debounceTime(0),
          map(([query, unifiedSearchFilters]) => {
            return {
              query: query ?? dataService.query.queryString.getDefaultQuery(),
              filters: unifiedSearchFilters ?? [],
            };
          }),
          distinctUntilChanged()
        ),
      },
      {
        query: true,
        filters: true,
      }
    );

    unifiedSearchSubscriptions.add(
      timefilterService.getTimeUpdate$().subscribe(() => {
        const urlOverrideTimeRange =
          creationOptions?.unifiedSearchSettings?.kbnUrlStateStorage.get<GlobalQueryStateFromUrl>(
            GLOBAL_STATE_STORAGE_KEY
          )?.time;
        if (urlOverrideTimeRange) {
          setTimeRange(urlOverrideTimeRange);
          return;
        }

        const lastSavedTimeRange = getLastSavedState()?.timeRange;
        if (timeRestore$.value && lastSavedTimeRange) {
          setAndSyncTimeRange(lastSavedTimeRange);
          return;
        }

        setTimeRange(timefilterService.getTime());
      })
    );
    unifiedSearchSubscriptions.add(
      timefilterService.getRefreshIntervalUpdate$().subscribe(() => {
        const urlOverrideRefreshInterval =
          creationOptions?.unifiedSearchSettings?.kbnUrlStateStorage.get<GlobalQueryStateFromUrl>(
            GLOBAL_STATE_STORAGE_KEY
          )?.refreshInterval;
        if (urlOverrideRefreshInterval) {
          setRefreshInterval(urlOverrideRefreshInterval);
          return;
        }

        const lastSavedRefreshInterval = getLastSavedState()?.refreshInterval;
        if (timeRestore$.value && lastSavedRefreshInterval) {
          setAndSyncRefreshInterval(lastSavedRefreshInterval);
          return;
        }

        setRefreshInterval(timefilterService.getRefreshInterval());
      })
    );
    unifiedSearchSubscriptions.add(
      timefilterService
        .getAutoRefreshFetch$()
        .pipe(
          tap(() => {
            controlGroupReload$.next();
            panelsReload$.next();
          }),
          switchMap((done) => waitForPanelsToLoad$.pipe(finalize(done)))
        )
        .subscribe()
    );
  }

  const comparators = {
    filters: (a, b) =>
      compareFilters(
        (a ?? []).filter((f) => !isFilterPinned(f)),
        (b ?? []).filter((f) => !isFilterPinned(f)),
        COMPARE_ALL_OPTIONS
      ),
    query: 'deepEquality',
    refreshInterval: (a: RefreshInterval | undefined, b: RefreshInterval | undefined) =>
      timeRestore$.value ? fastIsEqual(a, b) : true,
    timeRange: (a: TimeRange | undefined, b: TimeRange | undefined) => {
      if (!timeRestore$.value) return true; // if time restore is set to false, time range doesn't count as a change.
      if (!areTimesEqual(a?.from, b?.from) || !areTimesEqual(a?.to, b?.to)) {
        return false;
      }
      return true;
    },
  } as StateComparators<
    Pick<DashboardState, 'filters' | 'query' | 'refreshInterval' | 'timeRange'>
  >;

  const getState = (): Pick<
    DashboardState,
    'filters' | 'query' | 'refreshInterval' | 'timeRange' | 'timeRestore'
  > => {
    // pinned filters are not serialized when saving the dashboard
    const serializableFilters = unifiedSearchFilters$.value?.filter((f) => !isFilterPinned(f));

    return {
      filters: serializableFilters,
      query: query$.value,
      refreshInterval: refreshInterval$.value,
      timeRange: timeRange$.value,
      timeRestore: timeRestore$.value ?? DEFAULT_DASHBOARD_STATE.timeRestore,
    };
  };

  return {
    api: {
      filters$,
      esqlVariables$,
      forceRefresh: () => {
        controlGroupReload$.next();
        panelsReload$.next();
      },
      query$,
      refreshInterval$,
      setFilters: setUnifiedSearchFilters,
      setQuery,
      setTimeRange: setAndSyncTimeRange,
      timeRange$,
      timeslice$,
      unifiedSearchFilters$,
    },
    internalApi: {
      controlGroupReload$,
      startComparing$: (lastSavedState$: BehaviorSubject<DashboardState>) => {
        return combineLatest([unifiedSearchFilters$, query$, refreshInterval$, timeRange$]).pipe(
          debounceTime(100),
          map(([filters, query, refreshInterval, timeRange]) => ({
            filters,
            query,
            refreshInterval,
            timeRange,
          })),
          combineLatestWith(lastSavedState$),
          map(([latestState, lastSavedState]) =>
            diffComparators(comparators, lastSavedState, latestState)
          )
        );
      },
      panelsReload$,
      reset: (lastSavedState: DashboardState) => {
        setUnifiedSearchFilters([
          ...(unifiedSearchFilters$.value ?? []).filter(isFilterPinned),
          ...(lastSavedState.filters ?? []),
        ]);
        if (lastSavedState.query) {
          setQuery(lastSavedState.query);
        }
        if (lastSavedState.timeRestore) {
          setAndSyncRefreshInterval(lastSavedState.refreshInterval);
          setAndSyncTimeRange(lastSavedState.timeRange);
        }
      },
      getState,
    },
    cleanup: () => {
      controlGroupSubscriptions.unsubscribe();
      unifiedSearchSubscriptions.unsubscribe();
      stopSyncingWithUrl?.();
      stopSyncingAppFilters?.();
    },
  };
}

const convertTimeToUTCString = (time?: string | Moment): undefined | string => {
  if (moment(time).isValid()) {
    return moment(time).utc().format('YYYY-MM-DDTHH:mm:ss.SSS[Z]');
  } else {
    // If it's not a valid moment date, then it should be a string representing a relative time
    // like 'now' or 'now-15m'.
    return time as string;
  }
};

export const areTimesEqual = (
  timeA?: string | Moment | undefined,
  timeB?: string | Moment | undefined
) => {
  return convertTimeToUTCString(timeA) === convertTimeToUTCString(timeB);
};
