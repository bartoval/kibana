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
  InvestigationDirection,
  InvestigationEvidenceReference,
  InvestigationTimeRange,
} from '../../common/selection_investigation';
import {
  INVESTIGATION_MATERIAL_MIN_ABSOLUTE_CHANGE,
  INVESTIGATION_MATERIAL_MIN_CHANGE_SHARE,
  INVESTIGATION_MATERIAL_MIN_POISSON_CHANGE,
  INVESTIGATION_MATERIAL_MIN_RELATIVE_CHANGE,
  INVESTIGATION_MAX_ROWS,
} from './constants';
import { scopeDocumentsQueryToEvidence } from './query';

// What a probe can actually be. Narrower than InvestigationPhase, which also covers 'planning' —
// a phase the agent goes through but never a query the server runs.
export type EvidencePurpose = 'total' | 'contributors' | 'patterns';
export type EvidenceValue = string | number | boolean | null;

/** Total rise and total fall across a comparison, kept apart so each row is judged against its own. */
export interface ChangeMass {
  positive: number;
  negative: number;
}

export interface EvidenceInputRow {
  key: EvidenceValue;
  selectionCount: number;
  baselineCount: number;
}

export interface EvidenceRow extends EvidenceInputRow {
  evidenceRowId: string;
  typedKey: string;
  delta: number;
  absoluteChange: number;
  relativeChange: number | null;
  poissonNormalizedChange: number;
  candidateShare: number;
  direction: InvestigationDirection;
  material: boolean;
  documentsQuery: string;
}

export interface EvidenceRecord {
  evidenceId: string;
  runId: string;
  purpose: EvidencePurpose;
  dimension: string;
  query: string;
  selection: InvestigationTimeRange;
  baseline: InvestigationTimeRange;
  filterCount: number;
  scope?: InvestigationEvidenceReference;
  materialRowCount: number;
  rows: EvidenceRow[];
}

export class EvidenceLedger {
  private readonly records = new Map<string, EvidenceRecord>();

  constructor(
    public readonly runId: string,
    public readonly selection: InvestigationTimeRange,
    public readonly baseline: InvestigationTimeRange
  ) {}

  public add(record: EvidenceRecord): void {
    if (record.runId === this.runId) {
      this.records.set(record.evidenceId, record);
    }
  }

  public list(): EvidenceRecord[] {
    return [...this.records.values()];
  }

  public resolve(reference: InvestigationEvidenceReference) {
    const record = this.records.get(reference.evidenceId);
    const row = record?.rows.find(({ evidenceRowId }) => evidenceRowId === reference.evidenceRowId);
    return record && row ? { record, row } : null;
  }

  // True when a row really is a smaller slice than the one it came from. Stops the agent from
  // "drilling into" a value that in fact covers everything it already had.
  public isScopeNarrowing(reference: InvestigationEvidenceReference): boolean {
    const resolved = this.resolve(reference);
    if (!resolved || resolved.record.purpose === 'total') return false;
    const parentRow = resolved.record.scope
      ? this.resolve(resolved.record.scope)?.row
      : this.list().find(({ purpose }) => purpose === 'total')?.rows[0];
    return Boolean(
      parentRow &&
        (resolved.row.selectionCount < parentRow.selectionCount ||
          resolved.row.baselineCount < parentRow.baselineCount)
    );
  }
}

const directionFor = (
  selectionCount: number,
  baselineCount: number,
  delta: number
): InvestigationDirection => {
  if (baselineCount === 0 && selectionCount > 0) return 'new';
  if (selectionCount === 0 && baselineCount > 0) return 'disappeared';
  return delta >= 0 ? 'increased' : 'decreased';
};

// A change counts only if it is big enough on its own, is a real share of everything that moved,
// and is either a large proportional jump or too big to be ordinary random fluctuation.
const isMaterial = (row: {
  absoluteChange: number;
  relativeChange: number | null;
  poissonNormalizedChange: number;
  candidateShare: number;
}): boolean =>
  row.absoluteChange >= INVESTIGATION_MATERIAL_MIN_ABSOLUTE_CHANGE &&
  row.candidateShare >= INVESTIGATION_MATERIAL_MIN_CHANGE_SHARE &&
  (row.relativeChange === null ||
    row.relativeChange >= INVESTIGATION_MATERIAL_MIN_RELATIVE_CHANGE ||
    Math.abs(row.poissonNormalizedChange) >= INVESTIGATION_MATERIAL_MIN_POISSON_CHANGE);

export const createEvidenceRecord = ({
  runId,
  purpose,
  dimension,
  query,
  documentsQuery,
  selection,
  baseline,
  inputRows,
  filterCount = 0,
  documentsFilterMode = 'equals',
  comparisonChangeMass,
  scopeReference,
}: {
  runId: string;
  purpose: EvidencePurpose;
  dimension: string;
  query: string;
  documentsQuery: string;
  selection: InvestigationTimeRange;
  baseline: InvestigationTimeRange;
  inputRows: EvidenceInputRow[];
  filterCount?: number;
  documentsFilterMode?: 'equals' | 'rlike';
  comparisonChangeMass?: ChangeMass;
  scopeReference?: InvestigationEvidenceReference;
}): EvidenceRecord => {
  // Message patterns can come back empty for documents with no message; those rows have nothing
  // to show or filter by, so they are dropped rather than failing the whole probe.
  const usableRows = inputRows.filter(
    ({ key }) => documentsFilterMode !== 'rlike' || typeof key === 'string'
  );
  const changeMass = comparisonChangeMass ?? {
    positive: usableRows.reduce(
      (sum, r) => sum + Math.max(r.selectionCount - r.baselineCount, 0),
      0
    ),
    negative: usableRows.reduce(
      (sum, r) => sum + Math.max(r.baselineCount - r.selectionCount, 0),
      0
    ),
  };
  const rows = usableRows
    .map((input) => {
      const delta = input.selectionCount - input.baselineCount;
      const absoluteChange = Math.abs(delta);
      const relativeChange = input.baselineCount > 0 ? absoluteChange / input.baselineCount : null;
      // How many "typical wobbles" this change is worth: counting noise grows with the square
      // root of the volume, so 20 extra events matter far more at 100 than at 100,000.
      const poissonNormalizedChange =
        delta / Math.sqrt(Math.max(input.selectionCount + input.baselineCount, 1));
      // This row's slice of everything that moved the same way it did, from 0 to 1. Comparing a
      // fall against the total rise would hide every disappearance whenever increases dominate.
      const candidateShare =
        absoluteChange / Math.max(delta >= 0 ? changeMass.positive : changeMass.negative, 1);
      const direction = directionFor(input.selectionCount, input.baselineCount, delta);
      const row = {
        ...input,
        evidenceRowId: `er_${uuidv4()}`,
        typedKey: `${input.key === null ? 'null' : typeof input.key}:${String(input.key)}`,
        delta,
        absoluteChange,
        relativeChange,
        poissonNormalizedChange,
        candidateShare,
        direction,
        documentsQuery:
          purpose === 'total'
            ? documentsQuery
            : scopeDocumentsQueryToEvidence({
                query: documentsQuery,
                field: dimension,
                value: input.key,
                mode: documentsFilterMode,
              }),
      };
      return { ...row, material: isMaterial(row) };
    })
    .sort((left, right) => right.absoluteChange - left.absoluteChange)
    .slice(0, INVESTIGATION_MAX_ROWS);

  return {
    evidenceId: `ev_${uuidv4()}`,
    runId,
    purpose,
    dimension,
    query,
    selection,
    baseline,
    filterCount,
    scope: scopeReference,
    materialRowCount: rows.filter(({ material }) => material).length,
    rows,
  };
};
