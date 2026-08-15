/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { ISuggestionItem } from '../../../../../../registry/types';
import type { ExpressionContext, PartialOperatorDetection } from '../../types';
import { getFunctionDefinition } from '../../../../functions';
import { createSyntheticListOperatorNode } from './utils';
import { dispatchOperators } from '../dispatcher';
import { normalizeWhitespace } from '../../../../regex';

const NULL_CHECK_CANDIDATES = ['is null', 'is not null'] as const;

/**
 * Handles IS NULL / IS NOT NULL partial operators.
 * Generates suggestions directly without creating synthetic nodes.
 * Supports prefix matching: "IS N" suggests both IS NULL and IS NOT NULL.
 */
export async function handleNullCheckOperator(
  { textBeforeCursor }: PartialOperatorDetection,
  { innerText }: ExpressionContext
): Promise<ISuggestionItem[] | null> {
  const text = textBeforeCursor || innerText;
  const queryNormalized = normalizeWhitespace(text.toLowerCase());

  const suggestions: ISuggestionItem[] = [];

  for (const name of NULL_CHECK_CANDIDATES) {
    const def = getFunctionDefinition(name);

    if (!def) {
      continue;
    }

    const candidateLower = name.toLowerCase();
    const matches = [...candidateLower].some((_, i) =>
      queryNormalized.endsWith(candidateLower.slice(0, i + 1))
    );

    if (matches) {
      suggestions.push({
        label: name.toUpperCase(),
        text: name.toUpperCase(),
        kind: 'Operator',
        detail: def.description,
      });
    }
  }

  return suggestions.length > 0 ? suggestions : null;
}

/**
 * Handles IN / NOT IN when the parser has not produced an operator node
 * (e.g. nested commas in CASE, or a collapsed expression).
 */
export async function handleInOperator(
  { operatorName, textBeforeCursor }: PartialOperatorDetection,
  context: ExpressionContext
): Promise<ISuggestionItem[] | null> {
  const text = textBeforeCursor || context.innerText;
  const leftOperand =
    context.expressionRoot?.type === 'column' ? context.expressionRoot : undefined;

  context.expressionRoot = createSyntheticListOperatorNode(operatorName, text, leftOperand);
  context.innerText = text;

  return dispatchOperators(context);
}
