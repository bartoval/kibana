/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  InvestigationCoverageIssue,
  InvestigationEvidenceReference,
  InvestigationFinding,
  InvestigationFindingTriage,
  InvestigationModelOutput,
  InvestigationPreviewRow,
  InvestigationScope,
  InvestigationTriagePriority,
  InvestigationTriageSignal,
  SelectionInvestigationResult,
} from '../../common/selection_investigation';
import { SELECTION_INVESTIGATION_MAX_SCOPE_DEPTH } from '../../common/selection_investigation';
import type { EvidenceLedger, EvidenceRecord, EvidenceRow } from './evidence';
import {
  INVESTIGATION_MAX_FINDINGS,
  INVESTIGATION_MIN_DRILLDOWN_ABSOLUTE_CHANGE,
  INVESTIGATION_TRIAGE_CONCENTRATED_MIN_CHANGE_SHARE,
  INVESTIGATION_TRIAGE_LARGE_MIN_POISSON_CHANGE,
} from './constants';

const toPreview = (record: EvidenceRecord): InvestigationPreviewRow[] =>
  record.rows.map(({ key, selectionCount, baselineCount, delta }) => ({
    key: String(key),
    selectionCount,
    baselineCount,
    delta,
  }));

const evidenceScopes = (
  ledger: EvidenceLedger,
  primary: { record: EvidenceRecord; row: EvidenceRow }
): InvestigationScope[] => {
  const scopes: InvestigationScope[] = [];
  let current: { record: EvidenceRecord; row: EvidenceRow } | null = primary;
  while (current) {
    scopes.unshift({
      field: current.record.dimension,
      value: current.row.key,
      mode: current.record.purpose === 'patterns' ? 'rlike' : 'equals',
    });
    current = current.record.scope ? ledger.resolve(current.record.scope) : null;
  }
  return scopes;
};

const mergeScopes = (
  baseScopes: InvestigationScope[],
  currentScopes: InvestigationScope[]
): InvestigationScope[] => {
  const seen = new Set<string>();
  return [...baseScopes, ...currentScopes].filter(({ field, value, mode }) => {
    const key = `${mode}:${field}:${typeof value}:${String(value)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const validatePatternTokens = (
  record: EvidenceRecord,
  row: EvidenceRow,
  requestedTokens: string[]
): string[] => {
  if (record.purpose !== 'patterns' || typeof row.key !== 'string') return [];
  const normalizedPattern = row.key.replaceAll('\\', '').toLowerCase();
  const seen = new Set<string>();
  const tokens = requestedTokens
    .map((token) => token.replaceAll('\\', '').trim())
    .filter((token) => {
      const normalized = token.toLowerCase();
      if (
        normalized.length < 2 ||
        (normalized.match(/[\p{L}\p{N}]/gu)?.length ?? 0) < 2 ||
        seen.has(normalized) ||
        !normalizedPattern.includes(normalized)
      ) {
        return false;
      }
      seen.add(normalized);
      return true;
    })
    .slice(0, 4);

  return tokens;
};

const scopeEvidence = (
  ledger: EvidenceLedger,
  record: EvidenceRecord
): InvestigationEvidenceReference[] => {
  const references: InvestigationEvidenceReference[] = [];
  let reference = record.scope;
  while (reference) {
    const resolved = ledger.resolve(reference);
    if (!resolved?.row.material) break;
    references.push(reference);
    reference = resolved.record.scope;
  }
  return references;
};

const supportsTriageSignal = ({
  signal,
  record,
  row,
  pathLength,
  supportingCount,
}: {
  signal: InvestigationTriageSignal;
  record: EvidenceRecord;
  row: EvidenceRow;
  pathLength: number;
  supportingCount: number;
}): boolean => {
  switch (signal) {
    case 'material_change':
      return row.material;
    case 'new_activity':
      return row.direction === 'new';
    case 'disappeared_activity':
      return row.direction === 'disappeared';
    case 'large_shift':
      return Math.abs(row.poissonNormalizedChange) >= INVESTIGATION_TRIAGE_LARGE_MIN_POISSON_CHANGE;
    case 'concentrated_shift':
      return row.candidateShare >= INVESTIGATION_TRIAGE_CONCENTRATED_MIN_CHANGE_SHARE;
    case 'scoped_change':
      return pathLength > 1;
    case 'message_pattern':
      return record.purpose === 'patterns';
    case 'multiple_evidence':
      return supportingCount > 0;
  }
};

const createTriage = ({
  pathLength,
  record,
  row,
  supportingCount,
  requested,
}: {
  pathLength: number;
  record: EvidenceRecord;
  row: EvidenceRow;
  supportingCount: number;
  requested: InvestigationModelOutput['candidates'][number]['triage'];
}): InvestigationFindingTriage => {
  const context = {
    record,
    row,
    pathLength,
    supportingCount,
  };
  // The agent proposes reasons; each one is kept only if the numbers on the row actually back it.
  const requestedSignals = [...new Set(requested.signals)].filter((signal) =>
    supportsTriageSignal({ signal, ...context })
  );
  const fallbackSignals: InvestigationTriageSignal[] = [
    'new_activity',
    'disappeared_activity',
    'message_pattern',
    'scoped_change',
    'multiple_evidence',
    'large_shift',
    'concentrated_shift',
    'material_change',
  ];
  const signals =
    requestedSignals.length > 0
      ? requestedSignals.slice(0, 3)
      : fallbackSignals
          .filter((signal) => supportsTriageSignal({ signal, ...context }))
          .slice(0, 1);
  const hasSignal = (signal: InvestigationTriageSignal) =>
    supportsTriageSignal({ signal, ...context });
  // What would make something worth looking at right now, judged from the evidence rather than
  // from the labels the agent chose to show. The urgency below is then corrected to match.
  const immediateSignal =
    hasSignal('new_activity') ||
    hasSignal('disappeared_activity') ||
    (hasSignal('large_shift') &&
      (hasSignal('concentrated_shift') ||
        hasSignal('scoped_change') ||
        hasSignal('message_pattern') ||
        hasSignal('multiple_evidence')));
  const priority =
    requested.priority === 'investigate_now' && !immediateSignal
      ? 'monitor'
      : requested.priority === 'informational' && immediateSignal
      ? 'monitor'
      : requested.priority;

  return {
    priority,
    signals,
    nextAction: record.purpose === 'total' ? 'open_query' : requested.nextAction,
  };
};

interface RankedFinding {
  finding: InvestigationFinding;
  record: EvidenceRecord;
  row: EvidenceRow;
  supportingCount: number;
}

const priorityRank: Record<InvestigationTriagePriority, number> = {
  investigate_now: 3,
  monitor: 2,
  informational: 1,
};

const compareFindings = (left: RankedFinding, right: RankedFinding): number =>
  priorityRank[right.finding.triage.priority] - priorityRank[left.finding.triage.priority] ||
  right.supportingCount - left.supportingCount ||
  Math.abs(right.row.poissonNormalizedChange) - Math.abs(left.row.poissonNormalizedChange) ||
  right.row.candidateShare - left.row.candidateShare ||
  right.row.absoluteChange - left.row.absoluteChange ||
  left.record.dimension.localeCompare(right.record.dimension) ||
  left.row.typedKey.localeCompare(right.row.typedKey);

export const getComparisonCoverageIssue = (
  ledger: EvidenceLedger
): InvestigationCoverageIssue | undefined => {
  const total = ledger.list().find(({ purpose }) => purpose === 'total')?.rows[0];
  if (!total || total.selectionCount === 0) {
    return 'selection_empty';
  }
  if (total.baselineCount === 0) {
    return 'baseline_empty';
  }
};

/**
 * Turns one evidence row into a finding. Everything a finding states — counts, direction, share,
 * queries, triage — comes from the ledger and the thresholds; the agent only ever chooses which
 * row this runs on, and which literals it proposes for a message pattern.
 */
const buildFinding = ({
  ledger,
  resolved,
  baseScopes,
  requestedTriage,
  requestedPatternTokens,
}: {
  ledger: EvidenceLedger;
  resolved: { record: EvidenceRecord; row: EvidenceRow };
  baseScopes: InvestigationScope[];
  requestedTriage: InvestigationModelOutput['candidates'][number]['triage'];
  requestedPatternTokens: string[];
}): RankedFinding => {
  const { record, row } = resolved;
  const supporting = scopeEvidence(ledger, record);
  const scopes = mergeScopes(baseScopes, evidenceScopes(ledger, resolved));
  const path = scopes.map(({ field, value }) => ({ dimension: field, value: String(value) }));

  return {
    finding: {
      id: `finding_${uuidv4()}`,
      kind:
        record.purpose === 'total'
          ? 'volume'
          : record.purpose === 'patterns'
          ? 'pattern'
          : 'contributor',
      dimension: record.dimension,
      value: String(row.key),
      patternTokens: validatePatternTokens(record, row, requestedPatternTokens),
      investigationPath: path,
      direction: row.direction,
      selectionCount: row.selectionCount,
      baselineCount: row.baselineCount,
      absoluteChange: row.absoluteChange,
      relativeChange: row.relativeChange,
      candidateShare: row.candidateShare,
      selection: record.selection,
      baseline: record.baseline,
      filterCount: record.filterCount,
      query: record.query,
      documentsQuery: row.documentsQuery,
      documentsTimeScope:
        row.direction === 'increased' || row.direction === 'new' ? 'selection' : 'baseline',
      preview: toPreview(record),
      scopes,
      triage: createTriage({
        pathLength: path.length,
        record,
        row,
        supportingCount: supporting.length,
        requested: requestedTriage,
      }),
      deeperInvestigation:
        record.purpose === 'total'
          ? 'not_applicable'
          : scopes.length >= SELECTION_INVESTIGATION_MAX_SCOPE_DEPTH
          ? 'max_depth_reached'
          : row.absoluteChange < INVESTIGATION_MIN_DRILLDOWN_ABSOLUTE_CHANGE
          ? 'change_too_small'
          : 'available',
    },
    record,
    row,
    supportingCount: supporting.length,
  };
};

/**
 * Used when the agent proposes nothing the evidence supports. It carries no judgement of its own,
 * so the wording stays neutral and the ranking decides the order.
 */
const NEUTRAL_TRIAGE: InvestigationModelOutput['candidates'][number]['triage'] = {
  priority: 'monitor',
  signals: [],
  nextAction: 'show_documents',
};

export const finalizeInvestigation = ({
  ledger,
  modelOutput,
  baseScopes,
}: {
  ledger: EvidenceLedger;
  modelOutput: InvestigationModelOutput;
  baseScopes: InvestigationScope[];
}): SelectionInvestigationResult => {
  // If the agent went deeper into a row and reported what it found there, the broader row it
  // started from is dropped: both describe the same change, and the deeper one says more.
  const supersededPrimaryReferences = new Set(
    modelOutput.candidates.flatMap(({ primary }) => {
      const resolved = ledger.resolve(primary);
      return resolved?.record.scope
        ? [`${resolved.record.scope.evidenceId}:${resolved.record.scope.evidenceRowId}`]
        : [];
    })
  );
  const agentFindings = modelOutput.candidates
    .slice(0, INVESTIGATION_MAX_FINDINGS)
    .flatMap((candidate): RankedFinding[] => {
      if (
        supersededPrimaryReferences.has(
          `${candidate.primary.evidenceId}:${candidate.primary.evidenceRowId}`
        )
      ) {
        return [];
      }
      const resolved = ledger.resolve(candidate.primary);
      if (!resolved?.row.material) return [];

      return [
        buildFinding({
          ledger,
          resolved,
          baseScopes,
          requestedTriage: candidate.triage,
          requestedPatternTokens: candidate.patternTokens,
        }),
      ];
    });

  const records = ledger.list();
  const probes = records.filter(({ purpose }) => purpose !== 'total');
  // The agent chose nothing the evidence backs, but the probes it ran did surface material rows.
  // The server has every number needed to rank them, so it answers rather than giving up.
  const ranked =
    agentFindings.length > 0
      ? agentFindings
      : probes.flatMap((record) =>
          record.rows
            .filter(({ material }) => material)
            .map((row) =>
              buildFinding({
                ledger,
                resolved: { record, row },
                baseScopes,
                requestedTriage: NEUTRAL_TRIAGE,
                requestedPatternTokens: [],
              })
            )
        );
  ranked.sort(compareFindings);
  const findings = ranked.slice(0, INVESTIGATION_MAX_FINDINGS).map(({ finding }) => finding);

  if (findings.length > 0) {
    const first = ranked[0];
    return {
      outcome: 'changes_found',
      findingsSelectedBy: agentFindings.length > 0 ? 'agent' : 'server_ranking',
      findings,
      triage: { ...first.finding.triage, findingId: first.finding.id },
    };
  }

  const total = records.find(({ purpose }) => purpose === 'total');
  // The total is the premise of the investigation, not something it discovered — and in a scoped
  // run it restates the row the user drilled into, so it is always material.
  if (total) {
    // A probe the server refused, or one that failed, never reaches the ledger. Reporting "nothing
    // changed" when nothing was actually checked would present a failure as a result.
    if (probes.length === 0) {
      return {
        outcome: 'insufficient_evidence',
        findings: [],
        insufficientEvidenceReason: 'no_checks_completed',
      };
    }

    // Saying "nothing changed" when the chart plainly shows a spike would contradict the user.
    return {
      outcome: total.rows[0]?.material ? 'unexplained_change' : 'no_material_change',
      findings: [],
    };
  }

  return { outcome: 'insufficient_evidence', findings: [] };
};
