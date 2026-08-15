/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { isFunctionExpression, within } from '@elastic/esql';
import { getExpressionType, getFunctionDefinition } from '../..';
import { buildMapValueCompleteItem } from '../../../../registry/complete_items';
import type { ISuggestionItem } from '../../../../registry/types';
import { inOperators, nullCheckOperators } from '../../../all_operators';
import { isExpressionComplete } from '../../expressions';
import { dispatchPartialOperators } from './operators/partial/dispatcher';
import { detectIn, detectNullCheck } from './operators/partial/utils';
import { getPosition, type ExpressionPosition } from './position';
import { dispatchStates } from './positions/dispatcher';
import type { MapParameters } from '../map_expression';
import { DOUBLE_QUOTED_STRING_REGEX, getCommandMapExpressionSuggestions } from '../map_expression';
import { extractSignatureMapParams } from '../../signatures';
import type {
  ExpressionComputedMetadata,
  ExpressionContext,
  ExpressionContextOptions,
  SuggestForExpressionParams,
  SuggestForExpressionResult,
} from './types';
import { getKqlSuggestionsIfApplicable, isExpressionParenthesized } from './utils';
import { isInsideMapExpression, parseMapParams } from '../../maps';

// Matches tokens like "foo(" to recover function names when the AST is missing
const FUNCTION_CALL_REGEX = /\b([a-z_][a-z0-9_]*)\s*\(/gi;

/** Coordinates position detection, handler selection, and range attachment */
export async function suggestForExpression(
  params: SuggestForExpressionParams
): Promise<SuggestForExpressionResult> {
  const baseCtx = buildContext(params);
  const computed = computeDerivedState(baseCtx);

  const kqlSuggestions = await getKqlSuggestionsIfApplicable(baseCtx);

  if (kqlSuggestions !== null) {
    return {
      suggestions: kqlSuggestions,
      computed,
    };
  }

  const mapSuggestions = getMapExpressionSuggestions(baseCtx.innerText);

  if (mapSuggestions !== null) {
    return {
      suggestions: mapSuggestions,
      computed,
    };
  }

  const clonedCtx = { ...baseCtx };
  const partialSuggestions = await trySuggestForPartialOperators(clonedCtx);

  if (partialSuggestions !== null) {
    return {
      suggestions: partialSuggestions,
      computed: computeDerivedState(clonedCtx),
    };
  }

  const suggestions = await dispatchStates(baseCtx, computed.position);

  return {
    suggestions,
    computed,
  };
}

/**
 * Handles incomplete IS/IS NOT NULL operators from the source text, and IN/NOT IN
 * when the parser still has not produced an operator node.
 *
 * LIKE/RLIKE, and IN when `correctQuerySyntax` already produced a real AST node,
 * go through the normal after-operator flow.
 *
 * Use cases:
 * 1. Partial null-check typing: "field IS ", "field IS N" - prefix-match IS NULL / IS NOT NULL
 * 2. IN without an AST node: nested commas like CASE(..., field IN (, or a collapsed parse
 *
 * Skips when AST has a complete operator node - normal flow handles it.
 */
async function trySuggestForPartialOperators(
  ctx: ExpressionContext
): Promise<ISuggestionItem[] | null> {
  const { innerText, expressionRoot } = ctx;

  const detection = detectNullCheck(innerText) || detectIn(innerText);

  if (!detection) {
    return null;
  }

  if (expressionRoot?.type === 'function') {
    const astOperatorName = expressionRoot.name?.toLowerCase();
    const isIncomplete = expressionRoot.incomplete;

    const managedPartialOperators = [
      ...nullCheckOperators.map((op) => op.name),
      ...inOperators.map((op) => op.name),
    ];

    // Real IN/NOT IN nodes (including those recovered by syntax correction) use the AST.
    // Incomplete null-checks still need prefix matching ("IS N").
    const isInOperatorNode = inOperators.some((op) => op.name === astOperatorName);
    if (isInOperatorNode || (managedPartialOperators.includes(astOperatorName) && !isIncomplete)) {
      return null;
    }
  }

  return dispatchPartialOperators(detection.operatorName, detection, ctx);
}

/** Derives innerText and option flags from the incoming params.*/
function buildContext(params: SuggestForExpressionParams): ExpressionContext {
  const { query, cursorPosition, expressionRoot } = params;
  const innerText = query.slice(0, cursorPosition);
  const isCursorFollowedByComma = query.slice(cursorPosition).trimStart().startsWith(',');
  const isCursorFollowedByParens = query.slice(cursorPosition).trimStart().startsWith('(');
  const isExpressionRootParenthesized = isExpressionParenthesized(innerText, expressionRoot);

  const baseOptions: ExpressionContextOptions = params.options ?? ({} as ExpressionContextOptions);
  const options: ExpressionContextOptions = {
    ...baseOptions,
    isCursorFollowedByComma,
    isCursorFollowedByParens,
  };

  return {
    query,
    cursorPosition,
    innerText,
    expressionRoot,
    isExpressionRootParenthesized,
    location: params.location!,
    command: params.command,
    context: params.context,
    callbacks: params.callbacks,
    options,
  };
}

/** Computes derived state from the expression context */
function computeDerivedState(ctx: ExpressionContext): ExpressionComputedMetadata {
  const { expressionRoot, innerText, cursorPosition, context } = ctx;
  const position: ExpressionPosition = getPosition(innerText, expressionRoot);
  const expressionType = getExpressionType(
    expressionRoot,
    context?.columns,
    context?.unmappedFieldsStrategy
  );
  const isComplete = isExpressionComplete(expressionType, innerText);
  const insideFunction =
    (expressionRoot &&
      isFunctionExpression(expressionRoot) &&
      within(cursorPosition, expressionRoot)) ||
    isMapExpressionInFunctionCall(innerText);

  return {
    innerText,
    position,
    expressionType,
    isComplete,
    insideFunction,
  };
}

function getMapExpressionSuggestions(innerText: string): ISuggestionItem[] | null {
  if (!isInsideMapExpression(innerText)) {
    return null;
  }

  const functionName = getLastFunctionName(innerText);
  const functionDef = functionName && getFunctionDefinition(functionName);
  const mapParamsStr = functionDef && extractSignatureMapParams(functionDef.signatures);

  if (!mapParamsStr) {
    return null;
  }

  const parsedParameters = parseMapParams(mapParamsStr);
  if (Object.keys(parsedParameters).length === 0) {
    return null;
  }

  const availableParameters = Object.entries(parsedParameters).reduce<MapParameters>(
    (acc, [paramName, paramDef]) => {
      acc[paramName] = {
        ...paramDef,
        suggestions: paramDef.values.map((value) => buildMapValueCompleteItem(value)),
      };
      return acc;
    },
    {}
  );
  const suggestions = getCommandMapExpressionSuggestions(innerText, availableParameters, true);
  return suggestions.length > 0 ? suggestions : [];
}

function isMapExpressionInFunctionCall(innerText: string): boolean {
  if (!isInsideMapExpression(innerText)) {
    return false;
  }

  return getLastFunctionName(innerText) !== null;
}

function getLastFunctionName(innerText: string): string | null {
  // Limit search to the text before the current map and ignore function-like tokens inside strings
  const lastOpenBrace = innerText.lastIndexOf('{');
  const searchText = lastOpenBrace >= 0 ? innerText.slice(0, lastOpenBrace) : innerText;
  const textWithoutStrings = searchText.replace(DOUBLE_QUOTED_STRING_REGEX, ' ');

  const allMatches = [...textWithoutStrings.matchAll(FUNCTION_CALL_REGEX)];
  const fnMatch = allMatches.length > 0 ? allMatches[allMatches.length - 1] : null;

  return fnMatch ? fnMatch[1].toLowerCase() : null;
}
