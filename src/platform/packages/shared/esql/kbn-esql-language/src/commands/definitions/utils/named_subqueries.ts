/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { isBinaryExpression, isIdentifier, isSource, isSubQuery } from '@elastic/esql';
import type {
  ESQLAstItem,
  ESQLAstHeaderCommand,
  ESQLAstLetHeaderCommand,
  ESQLAstQueryExpression,
  ESQLIdentifier,
  ESQLSource,
} from '@elastic/esql/types';

/** A `LET name = (subquery);` binding of the query header. */
export interface NamedSubquery {
  readonly name: string;
  readonly identifier: ESQLIdentifier;
  readonly query: ESQLAstQueryExpression;
  readonly command: ESQLAstLetHeaderCommand;
}

export const isLetHeaderCommand = (command: {
  type: string;
  name: string;
}): command is ESQLAstLetHeaderCommand =>
  command.type === 'header-command' && command.name === 'let';

const toNamedSubquery = (command: ESQLAstLetHeaderCommand): NamedSubquery | undefined => {
  const [binding] = command.args;
  if (!isBinaryExpression(binding)) {
    return undefined;
  }

  const [left, right] = binding.args;
  if (!isIdentifier(left) || !isSubQuery(right)) {
    return undefined;
  }

  return { name: left.name, identifier: left, query: right.child, command };
};

/**
 * Returns the `LET` bindings of a query header, in definition order.
 */
export const getNamedSubqueries = (header: readonly ESQLAstHeaderCommand[] = []): NamedSubquery[] =>
  header.filter(isLetHeaderCommand).flatMap((command) => toNamedSubquery(command) ?? []);

/**
 * Returns the bindings defined before `command`, the only ones its subquery can reference.
 */
export const getNamedSubqueriesBefore = (
  namedSubqueries: readonly NamedSubquery[],
  command: ESQLAstLetHeaderCommand
): NamedSubquery[] => {
  const index = namedSubqueries.findIndex((namedSubquery) => namedSubquery.command === command);

  return index === -1 ? [...namedSubqueries] : namedSubqueries.slice(0, index);
};

/**
 * Returns the binding referenced by a `FROM` source, if any. Only plain, local index
 * names (no cluster prefix, no selector) can reference a named subquery.
 */
export const findNamedSubqueryForSource = (
  source: ESQLSource,
  namedSubqueries: readonly NamedSubquery[]
): NamedSubquery | undefined => {
  if (source.sourceType !== 'index' || source.prefix || source.selector) {
    return undefined;
  }

  return namedSubqueries.find(({ name }) => name === source.name);
};

/**
 * Replaces the sources referencing a named subquery with the index sources of the
 * subquery source command, recursively.
 */
export const resolveNamedSubquerySources = (
  sources: readonly ESQLSource[],
  namedSubqueries: readonly NamedSubquery[]
): ESQLSource[] =>
  sources.flatMap((source) => {
    const namedSubquery = findNamedSubqueryForSource(source, namedSubqueries);
    if (!namedSubquery) {
      return [source];
    }

    const [sourceCommand] = namedSubquery.query.commands;
    const sourceCommandArgs: ESQLAstItem[] = sourceCommand?.args ?? [];
    const bodySources = sourceCommandArgs
      .filter(isSource)
      .filter(({ sourceType }) => sourceType === 'index');

    return resolveNamedSubquerySources(
      bodySources,
      getNamedSubqueriesBefore(namedSubqueries, namedSubquery.command)
    );
  });
