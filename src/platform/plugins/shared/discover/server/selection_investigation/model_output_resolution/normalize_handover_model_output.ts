/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { SELECTION_INVESTIGATION_MAX_GOAL_LENGTH } from '../../../common/selection_investigation';
import { INVESTIGATION_MAX_FINDINGS, INVESTIGATION_MAX_FOLLOW_UPS } from '../constants';

const ANSWER_STATUSES = [
  'supported',
  'partially_supported',
  'no_signal_found',
  'inconclusive',
  'insufficient_observability',
] as const;

const CANDIDATE_KINDS = ['metric', 'dimension', 'pattern'] as const;

const truncate = (value: unknown, maxLength: number): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed.length) {
    return undefined;
  }
  return trimmed.length <= maxLength ? trimmed : trimmed.slice(0, maxLength);
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const normalizeEvidenceReference = (value: unknown): Record<string, string> | undefined => {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const evidenceId = truncate(record.evidenceId, 100);
  const evidenceRowId = truncate(record.evidenceRowId, 100);
  if (!evidenceId || !evidenceRowId) {
    return undefined;
  }
  return { evidenceId, evidenceRowId };
};

const normalizeCandidate = (value: unknown): Record<string, unknown> | undefined => {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const primary = normalizeEvidenceReference(record.primary);
  const kind = CANDIDATE_KINDS.find((candidateKind) => candidateKind === record.kind);
  const title = truncate(record.title, 100);
  const interpretation = truncate(record.interpretation, 350);
  const openQuestion = truncate(record.openQuestion, 250);
  if (!primary || !kind || !title || !interpretation || !openQuestion) {
    return undefined;
  }
  return { primary, kind, title, interpretation, openQuestion };
};

const normalizeFollowUp = (value: unknown): Record<string, unknown> | undefined => {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const goal = truncate(record.goal, SELECTION_INVESTIGATION_MAX_GOAL_LENGTH);
  const reason = truncate(record.reason, 300);
  if (!goal || !reason || !Array.isArray(record.evidence)) {
    return undefined;
  }
  const evidence = record.evidence
    .map((item) => normalizeEvidenceReference(item))
    .filter((item): item is Record<string, string> => item !== undefined)
    .slice(0, INVESTIGATION_MAX_FINDINGS);
  if (!evidence.length) {
    return undefined;
  }
  return { goal, reason, evidence };
};

/**
 * Best-effort cleanup of model handover JSON before Zod validation (truncate lengths, drop invalid rows).
 */
export const normalizeHandoverModelOutput = (raw: unknown): unknown => {
  const root = asRecord(raw);
  if (!root) {
    return raw;
  }
  const answerRecord = asRecord(root.answer);
  if (!answerRecord) {
    return raw;
  }

  const status = ANSWER_STATUSES.find((value) => value === answerRecord.status);
  const title = truncate(answerRecord.title, 120);
  const summary = truncate(answerRecord.summary, 800);
  const nextStep = truncate(answerRecord.nextStep, 300);
  if (!status || !title || !summary || !nextStep) {
    return raw;
  }

  const candidates = Array.isArray(answerRecord.candidates)
    ? answerRecord.candidates
        .map((item) => normalizeCandidate(item))
        .filter((item): item is Record<string, unknown> => item !== undefined)
        .slice(0, INVESTIGATION_MAX_FINDINGS)
    : [];

  const followUps = Array.isArray(answerRecord.followUps)
    ? answerRecord.followUps
        .map((item) => normalizeFollowUp(item))
        .filter((item): item is Record<string, unknown> => item !== undefined)
        .slice(0, INVESTIGATION_MAX_FOLLOW_UPS)
    : [];

  return {
    answer: {
      status,
      title,
      summary,
      nextStep,
      candidates,
      followUps,
    },
  };
};
