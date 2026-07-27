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
import { INVESTIGATION_MAX_ROWS } from './constants';

export type EvidenceValue = string | number | boolean | null;

export interface EvidenceRow {
  evidenceRowId: string;
  key: EvidenceValue;
  // Missing from one bounded result is only a lead; the tool withholds its ID until it is verified.
  selectionValue: number | null;
  baselineValue: number | null;
  delta: number | null;
  absoluteChange: number | null;
  relativeChange: number | null;
  direction: InvestigationDirection | null;
}

interface ComparableEvidenceRow extends EvidenceRow {
  selectionValue: number;
  baselineValue: number;
  delta: number;
  absoluteChange: number;
  direction: InvestigationDirection;
}

export interface EvidenceRecord {
  evidenceId: string;
  runId: string;
  query: string;
  keyColumn?: string;
  metricColumn: string;
  selection: InvestigationTimeRange;
  baseline: InvestigationTimeRange;
  filterCount: number;
  esqlExecutionMs: number;
  rows: EvidenceRow[];
}

const directionFor = (delta: number): InvestigationDirection =>
  delta > 0 ? 'increased' : delta < 0 ? 'decreased' : 'unchanged';

export const isComparableEvidenceRow = (row: EvidenceRow): row is ComparableEvidenceRow =>
  row.selectionValue !== null &&
  row.baselineValue !== null &&
  row.delta !== null &&
  row.absoluteChange !== null &&
  row.direction !== null;

export const createEvidenceRecord = ({
  runId,
  query,
  keyColumn,
  metricColumn,
  selection,
  baseline,
  filterCount,
  esqlExecutionMs,
  values,
}: {
  runId: string;
  query: string;
  keyColumn?: string;
  metricColumn: string;
  selection: InvestigationTimeRange;
  baseline: InvestigationTimeRange;
  filterCount: number;
  esqlExecutionMs: number;
  values: Array<{
    key: EvidenceValue;
    selectionValue: number | null;
    baselineValue: number | null;
  }>;
}): EvidenceRecord => ({
  evidenceId: `ev_${uuidv4()}`,
  runId,
  query,
  keyColumn,
  metricColumn,
  selection,
  baseline,
  filterCount,
  esqlExecutionMs,
  rows: values
    .map(({ key, selectionValue, baselineValue }) => {
      if (selectionValue === null || baselineValue === null) {
        return {
          evidenceRowId: `er_${uuidv4()}`,
          key,
          selectionValue,
          baselineValue,
          delta: null,
          absoluteChange: null,
          relativeChange: null,
          direction: null,
        };
      }
      const delta = selectionValue - baselineValue;
      const absoluteChange = Math.abs(delta);
      return {
        evidenceRowId: `er_${uuidv4()}`,
        key,
        selectionValue,
        baselineValue,
        delta,
        absoluteChange,
        relativeChange: baselineValue === 0 ? null : absoluteChange / Math.abs(baselineValue),
        direction: directionFor(delta),
      };
    })
    .slice(0, INVESTIGATION_MAX_ROWS),
});

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

  public resolve(reference: InvestigationEvidenceReference) {
    const record = this.records.get(reference.evidenceId);
    const row = record?.rows.find(({ evidenceRowId }) => evidenceRowId === reference.evidenceRowId);
    return record && row ? { record, row } : null;
  }

  // A one-value breakdown that repeats an existing total did not narrow the investigation.
  public isNonDiscriminating(record: EvidenceRecord): boolean {
    if (!record.keyColumn || record.rows.length !== 1) {
      return false;
    }
    const row = record.rows[0];
    if (!isComparableEvidenceRow(row)) {
      return false;
    }
    return [...this.records.values()].some((candidate) => {
      const candidateRow = candidate.rows[0];
      return (
        candidate.evidenceId !== record.evidenceId &&
        !candidate.keyColumn &&
        candidate.metricColumn === record.metricColumn &&
        candidate.rows.length === 1 &&
        candidateRow !== undefined &&
        isComparableEvidenceRow(candidateRow) &&
        candidateRow.selectionValue === row.selectionValue &&
        candidateRow.baselineValue === row.baselineValue
      );
    });
  }
}
