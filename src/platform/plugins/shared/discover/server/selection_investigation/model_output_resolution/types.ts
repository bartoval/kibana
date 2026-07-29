/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { InvestigationModelOutput } from '../../../common/selection_investigation';

/**
 * How Discover obtains {@link InvestigationModelOutput} from an Agent Builder run.
 * Swap this strategy (or replace the resolver module) without changing finalize/ledger logic.
 */
export type InvestigationModelOutputResolutionStrategy =
  | 'agent_builder_structured_output'
  | 'agent_builder_handover_json';

export type InvestigationModelOutputResolveFailureCode =
  | 'missing_payload'
  | 'json_extract_failed'
  | 'schema_invalid';

export type InvestigationModelOutputResolveResult =
  | {
      ok: true;
      data: InvestigationModelOutput;
      source: InvestigationModelOutputResolutionStrategy;
    }
  | {
      ok: false;
      code: InvestigationModelOutputResolveFailureCode;
      source: InvestigationModelOutputResolutionStrategy;
      zodError?: ReturnType<import('@kbn/zod/v4').z.ZodError['flatten']>;
      message?: string;
    };

export interface AgentBuilderMessageCompletePayload {
  structuredOutput?: unknown;
  messageContent: string;
}
