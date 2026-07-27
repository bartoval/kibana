/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { z } from '@kbn/zod/v4';
import type { InvestigationModelTriageSignal } from '../../common/selection_investigation';
import { INVESTIGATION_MAX_FINDINGS } from './constants';

const MODEL_TRIAGE_SIGNALS = [
  'new_activity',
  'disappeared_activity',
  'large_shift',
  'concentrated_shift',
  'scoped_change',
  'message_pattern',
  'multiple_evidence',
] as const satisfies readonly InvestigationModelTriageSignal[];

const evidenceReferenceSchema = z
  .object({
    evidenceId: z.string().max(100),
    evidenceRowId: z.string().max(100),
  })
  .strict();

export const investigationModelOutputSchema = z
  .object({
    candidates: z
      .array(
        z
          .object({
            primary: evidenceReferenceSchema,
            patternTokens: z.array(z.string().min(1).max(32)).max(4),
            triage: z
              .object({
                priority: z.enum(['investigate_now', 'monitor', 'informational']),
                signals: z.array(z.enum(MODEL_TRIAGE_SIGNALS)).min(1).max(3),
                nextAction: z.enum(['show_documents', 'open_query']),
              })
              .strict(),
          })
          .strict()
      )
      .max(INVESTIGATION_MAX_FINDINGS),
  })
  .strict();

const { $schema: _unusedSchemaKeyword, ...investigationOutputJsonSchema } = z.toJSONSchema(
  investigationModelOutputSchema
);

export const INVESTIGATION_OUTPUT_SCHEMA = investigationOutputJsonSchema;
