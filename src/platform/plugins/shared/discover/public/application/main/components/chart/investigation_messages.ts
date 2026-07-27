/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { i18n } from '@kbn/i18n';
import type {
  SelectionInvestigationResult,
  InvestigationCoverageIssue,
  InvestigationDeeperInvestigation,
  InvestigationDirection,
  InvestigationFinding,
  InvestigationTriageAction,
  InvestigationTriagePriority,
  InvestigationTriageSignal,
} from '../../../../../common/selection_investigation';

/**
 * Every user-facing sentence of an investigation. The server sends codes and numbers only, so all
 * of this is rendered in the reader's own locale.
 */

const PATTERN_CLAIMS: Record<InvestigationDirection, () => string> = {
  new: () =>
    i18n.translate('discover.investigateSelection.claim.pattern.new', {
      defaultMessage: 'A new log pattern appeared',
    }),
  disappeared: () =>
    i18n.translate('discover.investigateSelection.claim.pattern.disappeared', {
      defaultMessage: 'A previously observed log pattern disappeared',
    }),
  increased: () =>
    i18n.translate('discover.investigateSelection.claim.pattern.increased', {
      defaultMessage: 'A log pattern became more frequent',
    }),
  decreased: () =>
    i18n.translate('discover.investigateSelection.claim.pattern.decreased', {
      defaultMessage: 'A log pattern became less frequent',
    }),
};

const ACTIVITY_CLAIMS: Record<InvestigationDirection, () => string> = {
  new: () =>
    i18n.translate('discover.investigateSelection.claim.activity.new', {
      defaultMessage: 'New activity appeared in the selected period',
    }),
  disappeared: () =>
    i18n.translate('discover.investigateSelection.claim.activity.disappeared', {
      defaultMessage: 'Previously observed activity disappeared',
    }),
  increased: () =>
    i18n.translate('discover.investigateSelection.claim.activity.increased', {
      defaultMessage: 'Activity increased in the selected period',
    }),
  decreased: () =>
    i18n.translate('discover.investigateSelection.claim.activity.decreased', {
      defaultMessage: 'Activity decreased in the selected period',
    }),
};

export const findingClaim = ({ kind, direction }: InvestigationFinding): string =>
  (kind === 'pattern' ? PATTERN_CLAIMS : ACTIVITY_CLAIMS)[direction]();

export const findingCaveat = (): string =>
  i18n.translate('discover.investigateSelection.caveat', {
    defaultMessage: 'Observed association; this does not establish a cause.',
  });

export const patternDescription = (tokens: string[]): string | undefined =>
  tokens.length === 0
    ? undefined
    : i18n.translate('discover.investigateSelection.patternDescription', {
        defaultMessage: 'Pattern mentioning {tokens}',
        values: { tokens: tokens.join(', ') },
      });

const DEEPER_BLOCKED_HINTS: Record<
  Exclude<InvestigationDeeperInvestigation, 'available' | 'not_applicable'>,
  () => string
> = {
  change_too_small: () =>
    i18n.translate('discover.investigateSelection.deeper.changeTooSmall', {
      defaultMessage:
        'This change is too small to break down any further. Open the documents to look at the events themselves.',
    }),
  max_depth_reached: () =>
    i18n.translate('discover.investigateSelection.deeper.maxDepthReached', {
      defaultMessage:
        'This investigation has narrowed as far as it can. Open the documents to look at the events themselves.',
    }),
};

export const deeperBlockedHint = (state: InvestigationDeeperInvestigation): string | undefined =>
  state === 'available' || state === 'not_applicable' ? undefined : DEEPER_BLOCKED_HINTS[state]();

const TRIAGE_TITLES: Record<InvestigationTriagePriority, () => string> = {
  investigate_now: () =>
    i18n.translate('discover.investigateSelection.triage.investigateNow', {
      defaultMessage: 'Investigate now',
    }),
  monitor: () =>
    i18n.translate('discover.investigateSelection.triage.monitor', {
      defaultMessage: 'Monitor',
    }),
  informational: () =>
    i18n.translate('discover.investigateSelection.triage.informational', {
      defaultMessage: 'Informational',
    }),
};

export const triageTitle = (priority: InvestigationTriagePriority): string =>
  TRIAGE_TITLES[priority]();

export const triageSummary = ({
  priority,
  absoluteChange,
  pathLength,
  selectedBy,
}: {
  priority: InvestigationTriagePriority;
  absoluteChange: number;
  pathLength: number;
  selectedBy?: SelectionInvestigationResult['findingsSelectedBy'];
}): string => {
  // Nothing may be attributed to the agent here: it chose none of these findings.
  if (selectedBy === 'server_ranking') {
    return i18n.translate('discover.investigateSelection.triage.serverRankedSummary', {
      defaultMessage:
        'A material change of {absoluteChange} events, ranked from the evidence the investigation collected.',
      values: { absoluteChange },
    });
  }

  switch (priority) {
    case 'investigate_now':
      // At depth one nothing has been narrowed yet, so there is no persistence to claim.
      return pathLength > 1
        ? i18n.translate('discover.investigateSelection.triage.investigateNowSummary', {
            defaultMessage:
              'The agent prioritized a change of {absoluteChange} events that remained material across {pathLength, plural, one {# investigation step} other {# investigation steps}}.',
            values: { absoluteChange, pathLength },
          })
        : i18n.translate('discover.investigateSelection.triage.investigateNowDirectSummary', {
            defaultMessage: 'The agent prioritized a change of {absoluteChange} events.',
            values: { absoluteChange },
          });
    case 'monitor':
      return i18n.translate('discover.investigateSelection.triage.monitorSummary', {
        defaultMessage:
          'The agent found a material change of {absoluteChange} events, but the completed checks do not make it clearly urgent.',
        values: { absoluteChange },
      });
    case 'informational':
      return i18n.translate('discover.investigateSelection.triage.informationalSummary', {
        defaultMessage:
          'The agent found a material change of {absoluteChange} events that currently looks informational in the completed checks.',
        values: { absoluteChange },
      });
  }
};

const TRIAGE_SIGNAL_LABELS: Record<InvestigationTriageSignal, () => string> = {
  material_change: () =>
    i18n.translate('discover.investigateSelection.triage.signal.materialChange', {
      defaultMessage: 'The change passed the investigation materiality checks',
    }),
  new_activity: () =>
    i18n.translate('discover.investigateSelection.triage.signal.newActivity', {
      defaultMessage: 'This activity was absent from the previous period',
    }),
  disappeared_activity: () =>
    i18n.translate('discover.investigateSelection.triage.signal.disappearedActivity', {
      defaultMessage: 'Previously observed activity disappeared',
    }),
  large_shift: () =>
    i18n.translate('discover.investigateSelection.triage.signal.largeShift', {
      defaultMessage: 'The change is large relative to the observed volume',
    }),
  concentrated_shift: () =>
    i18n.translate('discover.investigateSelection.triage.signal.concentratedShift', {
      defaultMessage: 'One value accounts for much of the change in this check',
    }),
  scoped_change: () =>
    i18n.translate('discover.investigateSelection.triage.signal.scopedChange', {
      defaultMessage: 'The change remains visible after narrowing the investigation',
    }),
  message_pattern: () =>
    i18n.translate('discover.investigateSelection.triage.signal.messagePattern', {
      defaultMessage: 'The evidence includes a message pattern comparison',
    }),
  multiple_evidence: () =>
    i18n.translate('discover.investigateSelection.triage.signal.multipleEvidence', {
      defaultMessage: 'Multiple investigation steps support this path',
    }),
};

export const triageSignalLabel = (signal: InvestigationTriageSignal): string =>
  TRIAGE_SIGNAL_LABELS[signal]();

const TRIAGE_ACTION_LABELS: Record<InvestigationTriageAction, () => string> = {
  show_documents: () =>
    i18n.translate('discover.investigateSelection.triage.reviewDocuments', {
      defaultMessage: 'Review affected documents',
    }),
  open_query: () =>
    i18n.translate('discover.investigateSelection.triage.continueQuery', {
      defaultMessage: 'Continue with this query',
    }),
};

export const triageActionLabel = (action: InvestigationTriageAction): string =>
  TRIAGE_ACTION_LABELS[action]();

const COVERAGE_ISSUES: Record<InvestigationCoverageIssue, () => string> = {
  selection_empty: () =>
    i18n.translate('discover.investigateSelection.coverage.selectionEmpty', {
      defaultMessage: 'The selected period contains no data to investigate.',
    }),
  baseline_empty: () =>
    i18n.translate('discover.investigateSelection.coverage.baselineEmpty', {
      defaultMessage:
        'The previous period contains no comparable data, so the investigation cannot establish a material change.',
    }),
  no_checks_completed: () =>
    i18n.translate('discover.investigateSelection.coverage.noChecksCompleted', {
      defaultMessage:
        'None of the checks the investigation attempted could be completed, so nothing was compared against the previous period. This is not a statement that nothing changed.',
    }),
};

export const coverageIssueMessage = (issue: InvestigationCoverageIssue): string =>
  COVERAGE_ISSUES[issue]();

export const serverRankedFindingsMessage = (): string =>
  i18n.translate('discover.investigateSelection.serverRankedFindings', {
    defaultMessage:
      'The agent did not settle on a conclusion. These changes were ranked from the evidence it had already collected, so they carry no prioritisation of its own.',
  });

export const unexplainedChangeMessage = (): string =>
  i18n.translate('discover.investigateSelection.unexplainedChange', {
    defaultMessage:
      'The selected period does contain a change in volume, but none of the fields checked accounts for it. Try a narrower selection, or open the documents to look at the events themselves.',
  });

export const noMaterialChangeMessage = (): string =>
  i18n.translate('discover.investigateSelection.noMaterialChange', {
    defaultMessage: 'No material change found in the checks performed.',
  });
