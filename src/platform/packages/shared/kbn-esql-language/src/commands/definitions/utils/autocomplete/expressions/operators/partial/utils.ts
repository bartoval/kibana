/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type {
  ESQLFunction,
  ESQLList,
  ESQLUnknownItem,
  ESQLSingleAstItem,
} from '@elastic/esql/types';
import { Builder } from '@elastic/esql';
import type { PartialOperatorDetection } from '../../types';
import {
  endsWithInOrNotInToken,
  endsWithIsOrIsNotToken,
  NOT_IN_REGEX,
  IS_NOT_REGEX,
} from '../utils';
import { endsWithOpenParen } from '../../../../regex';

const FIELD_BEFORE_IN_REGEX = /([\w.]+)\s+(?:not\s+)?in\s*\(?\s*$/i;

/**
 * Creates a synthetic IN / NOT IN node when the parser has not produced one.
 * If innerText ends with "(", creates a list node instead of a placeholder.
 */
export function createSyntheticListOperatorNode(
  operatorName: string,
  innerText: string,
  leftOperand?: ESQLSingleAstItem
): ESQLFunction {
  const textLength = innerText.length;
  const hasOpenParen = endsWithOpenParen(innerText);

  const right = hasOpenParen ? createEmptyListNode(textLength) : createPlaceholderNode(textLength);
  const left = leftOperand ?? extractFieldFromText(innerText);

  return {
    type: 'function',
    name: operatorName,
    subtype: 'binary-expression',
    args: [left ?? createPlaceholderNode(0), right],
    incomplete: true,
    location: { min: textLength, max: textLength },
    text: operatorName,
  };
}

function createPlaceholderNode(textLength: number): ESQLUnknownItem {
  return {
    type: 'unknown',
    name: '',
    text: '',
    location: { min: textLength, max: textLength },
    incomplete: true,
  };
}

function createEmptyListNode(textLength: number): ESQLList {
  return Builder.expression.list.tuple(
    { text: '()', location: { min: textLength, max: textLength }, incomplete: true },
    { location: { min: textLength, max: textLength }, text: '()', incomplete: true }
  );
}

function extractFieldFromText(innerText: string): ESQLSingleAstItem | undefined {
  const match = innerText.match(FIELD_BEFORE_IN_REGEX);

  if (match?.[1]) {
    return Builder.expression.column(match[1]);
  }

  return undefined;
}

/**
 * Detects partial IS NULL / IS NOT NULL operators.
 * Examples: "field IS ", "field IS N", "field IS NOT ", "field IS NOT N"
 */
export function detectNullCheck(innerText: string): PartialOperatorDetection | null {
  if (!endsWithIsOrIsNotToken(innerText)) {
    return null;
  }

  const containsNot = IS_NOT_REGEX.test(innerText);

  return {
    operatorName: containsNot ? 'is not null' : 'is null',
    textBeforeCursor: innerText,
  };
}

/**
 * Detects partial IN / NOT IN operators when the AST may still be missing.
 * Examples: "field IN ", "field IN(", "field NOT IN ", "field NOT IN("
 */
export function detectIn(innerText: string): PartialOperatorDetection | null {
  if (!endsWithInOrNotInToken(innerText)) {
    return null;
  }

  const isNotIn = NOT_IN_REGEX.test(innerText);

  return {
    operatorName: isNotIn ? 'not in' : 'in',
    textBeforeCursor: innerText,
  };
}
