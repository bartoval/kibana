/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */
import type { ESQLAstAllCommands } from '@elastic/esql/types';
import {
  assignCompletionItem,
  buildSubqueryCompleteItems,
  semiColonCompleteItem,
} from '../complete_items';
import type { ICommandCallbacks, ICommandContext, ISuggestionItem } from '../types';

const NAME_TYPED_REGEX = /\bLET\s+[a-z_][\w]*\s+$/i;
const ASSIGN_TYPED_REGEX = /=\s*$/;
const SUBQUERY_CLOSED_REGEX = /\)\s*$/;

// LET <name> = (<subquery>);
// The cursor within the binding subquery is handled as a regular subquery context.
export async function autocomplete(
  query: string,
  command: ESQLAstAllCommands,
  _callbacks?: ICommandCallbacks,
  _context?: ICommandContext,
  cursorPosition?: number
): Promise<ISuggestionItem[]> {
  const innerText = query.substring(0, cursorPosition);
  const hasSemicolonAtEnd = /^\s*;/.test(query.substring(cursorPosition || 0));

  // LET <name> /
  if (NAME_TYPED_REGEX.test(innerText)) {
    return [{ ...assignCompletionItem, detail: '' }];
  }

  // LET <name> = /
  if (ASSIGN_TYPED_REGEX.test(innerText)) {
    return buildSubqueryCompleteItems();
  }

  // LET <name> = (<subquery>)/
  if (SUBQUERY_CLOSED_REGEX.test(innerText) && command.args.length > 0 && !hasSemicolonAtEnd) {
    return [
      {
        ...semiColonCompleteItem,
        text: ';\n', // Add a new line so the next instruction starts in the line below.
      },
    ];
  }

  // LET /  --- the binding name is user defined, nothing to suggest.
  return [];
}
