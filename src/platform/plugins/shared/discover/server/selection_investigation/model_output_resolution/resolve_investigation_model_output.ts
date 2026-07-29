/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { INVESTIGATION_MODEL_OUTPUT_RESOLUTION } from '../constants';
import { resolveFromAgentBuilderHandoverJson } from './resolve_from_handover_json';
import { resolveFromAgentBuilderStructuredOutput } from './resolve_from_agent_builder_structured';
import type {
  AgentBuilderMessageCompletePayload,
  InvestigationModelOutputResolutionStrategy,
  InvestigationModelOutputResolveResult,
} from './types';

export const resolveInvestigationModelOutput = ({
  strategy = INVESTIGATION_MODEL_OUTPUT_RESOLUTION,
  payload,
}: {
  strategy?: InvestigationModelOutputResolutionStrategy;
  payload: AgentBuilderMessageCompletePayload;
}): InvestigationModelOutputResolveResult => {
  if (strategy === 'agent_builder_structured_output') {
    return resolveFromAgentBuilderStructuredOutput(payload.structuredOutput);
  }

  return resolveFromAgentBuilderHandoverJson(payload.messageContent);
};
