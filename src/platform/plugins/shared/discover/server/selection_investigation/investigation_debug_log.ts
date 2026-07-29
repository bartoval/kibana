/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { Logger } from '@kbn/core/server';
import type { InvestigationModelOutput } from '../../common/selection_investigation';
import type { EvidenceLedger } from './evidence';
import { InvestigationError } from './errors';

export const SELECTION_INVESTIGATION_LOG_TAG = '[discover-selection-investigation]';

const formatLine = (
  runId: string,
  requestId: string,
  message: string,
  extra?: Record<string, unknown>
) => {
  if (!extra || Object.keys(extra).length === 0) {
    return `${SELECTION_INVESTIGATION_LOG_TAG} ${message} runId=${runId} requestId=${requestId}`;
  }
  return `${SELECTION_INVESTIGATION_LOG_TAG} ${message} runId=${runId} requestId=${requestId} ${JSON.stringify(
    extra
  )}`;
};

export const createInvestigationLogger = (logger: Logger, runId: string, requestId: string) => {
  return {
    info: (message: string, extra?: Record<string, unknown>) =>
      logger.info(formatLine(runId, requestId, message, extra)),
    warn: (message: string, extra?: Record<string, unknown>) =>
      logger.warn(formatLine(runId, requestId, message, extra)),
    debug: (message: string, extra?: Record<string, unknown>) =>
      logger.debug(formatLine(runId, requestId, message, extra)),
    error: (message: string, error: Error, extra?: Record<string, unknown>) =>
      logger.error(formatLine(runId, requestId, message, extra), { error }),
  };
};

export type InvestigationDebugLogger = ReturnType<typeof createInvestigationLogger>;

export const collectCitedEvidenceReferences = (modelOutput: InvestigationModelOutput) => ({
  candidates: modelOutput.answer.candidates.map(({ primary, kind, title }) => ({
    ...primary,
    kind,
    title,
  })),
  followUps: modelOutput.answer.followUps.map(({ goal, evidence }) => ({
    goal,
    evidence,
  })),
  status: modelOutput.answer.status,
});

export const logFinalizeFailure = ({
  log,
  error,
  ledger,
  modelOutput,
  elapsedMs,
}: {
  log: InvestigationDebugLogger;
  error: unknown;
  ledger: EvidenceLedger;
  modelOutput?: InvestigationModelOutput;
  elapsedMs: number;
}) => {
  const ledgerEvidence = ledger.listEvidenceReferences();
  if (error instanceof InvestigationError) {
    log.warn('Finalize failed', {
      elapsedMs,
      code: error.code,
      message: error.message,
      ledgerEvidence,
      ...(modelOutput ? { cited: collectCitedEvidenceReferences(modelOutput) } : {}),
    });
    return;
  }
  log.error('Finalize failed with unexpected error', error as Error, {
    elapsedMs,
    ledgerEvidence,
    ...(modelOutput ? { cited: collectCitedEvidenceReferences(modelOutput) } : {}),
  });
};
