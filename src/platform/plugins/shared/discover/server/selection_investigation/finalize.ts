/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */ import type {
  InvestigationEvidenceReference,
  InvestigationFinding,
  InvestigationModelOutput,
  SelectionInvestigationResult,
} from '../../common/selection_investigation';
import { InvestigationError } from './errors';
import {
  isComparableEvidenceRow,
  type EvidenceLedger,
  type EvidenceRecord,
  type EvidenceRow,
} from './evidence';

const referenceKey = ({ evidenceId, evidenceRowId }: InvestigationEvidenceReference): string =>
  `${evidenceId}:${evidenceRowId}`;

const displayValue = (value: EvidenceRow['key']): string =>
  value === null ? 'null' : String(value);

const toPreview = (record: EvidenceRecord) =>
  record.rows.flatMap((row) =>
    isComparableEvidenceRow(row)
      ? [
          {
            key: displayValue(row.key),
            selectionValue: row.selectionValue,
            baselineValue: row.baselineValue,
            delta: row.delta,
          },
        ]
      : []
  );

const resolveOrThrow = (
  ledger: EvidenceLedger,
  reference: InvestigationEvidenceReference
): NonNullable<ReturnType<EvidenceLedger['resolve']>> => {
  const resolved = ledger.resolve(reference);
  if (!resolved) {
    throw new InvestigationError(
      'protocol_violation',
      400,
      'The agent referenced evidence that was not produced by this investigation'
    );
  }
  return resolved;
};

const resolveComparableOrThrow = (
  ledger: EvidenceLedger,
  reference: InvestigationEvidenceReference
) => {
  const resolved = resolveOrThrow(ledger, reference);
  if (!isComparableEvidenceRow(resolved.row)) {
    throw new InvestigationError(
      'protocol_violation',
      400,
      'The agent must verify cited evidence in both periods'
    );
  }
  return { record: resolved.record, row: resolved.row };
};

const buildFinding = ({
  ledger,
  candidate,
}: {
  ledger: EvidenceLedger;
  candidate: InvestigationModelOutput['answer']['candidates'][number];
}): { finding: InvestigationFinding; record: EvidenceRecord } => {
  const { record, row } = resolveComparableOrThrow(ledger, candidate.primary);
  return {
    record,
    finding: {
      id: row.evidenceRowId,
      title: candidate.title,
      summary: `${candidate.interpretation} ${candidate.openQuestion}`,
      kind: candidate.kind,
      dimension: record.keyColumn ?? record.metricColumn,
      value: displayValue(row.key),
      direction: row.direction,
      selectionValue: row.selectionValue,
      baselineValue: row.baselineValue,
      absoluteChange: row.absoluteChange,
      relativeChange: row.relativeChange,
      selection: record.selection,
      baseline: record.baseline,
      filterCount: record.filterCount,
      query: record.query,
      preview: toPreview(record),
    },
  };
};

export const finalizeInvestigation = ({
  ledger,
  modelOutput,
}: {
  ledger: EvidenceLedger;
  modelOutput: InvestigationModelOutput;
}): SelectionInvestigationResult => {
  const seenCandidates = new Set<string>();
  const findings = modelOutput.answer.candidates.flatMap((candidate) => {
    const key = referenceKey(candidate.primary);
    if (seenCandidates.has(key)) {
      return [];
    }
    seenCandidates.add(key);
    const { finding, record } = buildFinding({ ledger, candidate });
    return candidate.kind !== 'metric' && ledger.isNonDiscriminating(record) ? [] : [finding];
  });
  if (
    (modelOutput.answer.status === 'supported' ||
      modelOutput.answer.status === 'partially_supported') &&
    findings.length === 0
  ) {
    throw new InvestigationError(
      'protocol_violation',
      400,
      'A supported or partially supported investigation answer must include a finding'
    );
  }
  modelOutput.answer.followUps.forEach(({ evidence }) =>
    evidence.forEach((reference) => resolveComparableOrThrow(ledger, reference))
  );

  return {
    findings,
    answer: {
      status: modelOutput.answer.status,
      title: modelOutput.answer.title,
      summary: modelOutput.answer.summary,
      nextStep: modelOutput.answer.nextStep,
      followUps: modelOutput.answer.followUps.map(({ goal, reason }) => ({
        goal,
        reason,
      })),
    },
  };
};
