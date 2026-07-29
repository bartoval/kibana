/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { investigationModelOutputSchema } from '../model_output';
import { extractJsonObjectFromAgentMessage } from './extract_json_from_agent_message';
import { normalizeHandoverModelOutput } from './normalize_handover_model_output';
import type { InvestigationModelOutputResolveResult } from './types';

export const resolveFromAgentBuilderHandoverJson = (
  messageContent: string
): InvestigationModelOutputResolveResult => {
  const source = 'agent_builder_handover_json' as const;
  if (!messageContent.trim()) {
    return { ok: false, code: 'missing_payload', source };
  }

  let extracted: unknown;
  try {
    extracted = extractJsonObjectFromAgentMessage(messageContent);
  } catch (error) {
    return {
      ok: false,
      code: 'json_extract_failed',
      source,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const normalized = normalizeHandoverModelOutput(extracted);
  const parsed = investigationModelOutputSchema.safeParse(normalized);
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
