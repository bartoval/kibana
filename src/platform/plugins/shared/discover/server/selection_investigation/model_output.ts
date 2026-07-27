/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { z } from '@kbn/zod/v4';
import { SELECTION_INVESTIGATION_MAX_GOAL_LENGTH } from '../../common/selection_investigation';
import { INVESTIGATION_MAX_FINDINGS, INVESTIGATION_MAX_FOLLOW_UPS } from './constants';

const evidenceReferenceSchema = z
  .object({
    evidenceId: z.string().trim().min(1).max(100),
    evidenceRowId: z.string().trim().min(1).max(100),
  })
  .strict();

export const investigationModelOutputSchema = z
  .object({
    answer: z
      .object({
        status: z.enum([
          'supported',
          'partially_supported',
          'no_signal_found',
          'inconclusive',
          'insufficient_observability',
        ]),
        title: z.string().trim().min(1).max(120),
        summary: z
          .string()
          .trim()
          .min(1)
          .max(800)
          .describe(
            'Synthesize how the selected findings relate to the mission. Add interpretation rather than listing the visible values.'
          ),
        nextStep: z.string().trim().min(1).max(300),
        followUps: z
          .array(
            z
              .object({
                goal: z.string().trim().min(1).max(SELECTION_INVESTIGATION_MAX_GOAL_LENGTH),
                reason: z.string().trim().min(1).max(300),
                evidence: z.array(evidenceReferenceSchema).min(1).max(INVESTIGATION_MAX_FINDINGS),
              })
              .strict()
          )
          .max(INVESTIGATION_MAX_FOLLOW_UPS),
        candidates: z
          .array(
            z
              .object({
                primary: evidenceReferenceSchema,
                kind: z.enum(['metric', 'dimension', 'pattern']),
                title: z.string().trim().min(1).max(100),
                interpretation: z
                  .string()
                  .trim()
                  .min(1)
                  .max(350)
                  .describe(
                    'Explain what this result reveals about the mission beyond its visible counts, including its relationship to other completed checks when useful.'
                  ),
                openQuestion: z
                  .string()
                  .trim()
                  .min(1)
                  .max(250)
                  .describe(
                    'State the specific important question that the completed checks did not resolve. Do not give generic advice.'
                  ),
              })
              .strict()
          )
          .max(INVESTIGATION_MAX_FINDINGS),
      })
      .strict(),
  })
  .strict();

const { $schema: _unusedSchemaKeyword, ...investigationOutputJsonSchema } = z.toJSONSchema(
  investigationModelOutputSchema
);

export const INVESTIGATION_OUTPUT_SCHEMA = investigationOutputJsonSchema;
