/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */
import { isAsExpression, isSource, Walker } from '@elastic/esql';
import type {
  ESQLAstQueryExpression,
  ESQLCommand,
  ESQLSource,
  ESQLAstItem,
} from '@elastic/esql/types';
import { getMessageFromId } from '../../definitions/utils';
import type { ESQLMessage } from '../../definitions/types';
import {
  findNamedSubqueryForSource,
  getNamedSubqueries,
  type NamedSubquery,
} from '../../definitions/utils/named_subqueries';

const UNSUPPORTED_COMMAND_LABELS: Readonly<Record<string, string>> = {
  ts: 'TS command',
  join: 'LOOKUP JOIN',
};

const getJoinTargetSource = (command: ESQLCommand): ESQLSource | undefined => {
  const [firstArg] = command.args;
  const target: ESQLAstItem | undefined = isAsExpression(firstArg) ? firstArg.args[0] : firstArg;

  return isSource(target) ? target : undefined;
};

const getReferencingSources = (command: ESQLCommand): ESQLSource[] => {
  switch (command.name) {
    case 'from':
    case 'ts':
      return command.args.filter(isSource);
    case 'join': {
      const target = getJoinTargetSource(command);
      return target ? [target] : [];
    }
    default:
      return [];
  }
};

/**
 * Validates the `FROM`/`TS`/`LOOKUP JOIN` references to named subqueries in `commands`,
 * where only `visible` bindings can be referenced.
 */
const validateReferences = (
  commands: ESQLCommand[],
  visible: readonly NamedSubquery[],
  all: readonly NamedSubquery[]
): ESQLMessage[] => {
  const messages: ESQLMessage[] = [];

  for (const command of commands) {
    for (const source of getReferencingSources(command)) {
      if (findNamedSubqueryForSource(source, visible)) {
        const unsupportedIn = UNSUPPORTED_COMMAND_LABELS[command.name];
        if (unsupportedIn) {
          messages.push(
            getMessageFromId({
              messageId: 'namedSubqueryNotSupportedInCommand',
              values: { command: unsupportedIn },
              locations: source.location,
            })
          );
        }
        continue;
      }

      if (findNamedSubqueryForSource(source, all)) {
        messages.push(
          getMessageFromId({
            messageId: 'namedSubqueryForwardReference',
            values: { name: source.name },
            locations: source.location,
          })
        );
      }
    }
  }

  return messages;
};

/**
 * Validates the `LET` bindings of a query and their references, following the
 * Elasticsearch sequential scoping: a binding can only reference bindings declared before it.
 */
export const validateNamedSubqueries = (root: ESQLAstQueryExpression): ESQLMessage[] => {
  const namedSubqueries = getNamedSubqueries(root.header);
  if (!namedSubqueries.length) {
    return [];
  }

  const messages: ESQLMessage[] = [];
  const declaredNames = new Set<string>();

  namedSubqueries.forEach(({ name, identifier, query }, index) => {
    if (name !== name.toLowerCase()) {
      messages.push(
        getMessageFromId({
          messageId: 'namedSubqueryMustBeLowercase',
          values: { name },
          locations: identifier.location,
        })
      );
    }

    if (declaredNames.has(name)) {
      messages.push(
        getMessageFromId({
          messageId: 'duplicateNamedSubquery',
          values: { name },
          locations: identifier.location,
        })
      );
    }
    declaredNames.add(name);

    messages.push(
      ...validateReferences(
        Walker.commands(query),
        namedSubqueries.slice(0, index),
        namedSubqueries
      )
    );
  });

  messages.push(
    ...validateReferences(
      Walker.commands(root, { skipHeader: true }),
      namedSubqueries,
      namedSubqueries
    )
  );

  return messages;
};
