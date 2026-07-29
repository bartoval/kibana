/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { investigationModelOutputSchema } from '../model_output';
import type { InvestigationModelOutputResolveResult } from './types';

export const resolveFromAgentBuilderStructuredOutput = (
  structuredOutput: unknown
): InvestigationModelOutputResolveResult => {
  const source = 'agent_builder_structured_output' as const;
  if (structuredOutput === undefined || structuredOutput === null) {
    return { ok: false, code: 'missing_payload', source };
  }

  const parsed = investigationModelOutputSchema.safeParse(structuredOutput);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'schema_invalid',
      source,
      zodError: parsed.error.flatten(),
    };
  }

  return { ok: true, data: parsed.data, source };
};
