/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */
import { uniqBy } from 'lodash';
import { isSource, isSubQuery } from '@elastic/esql';
import type { ESQLCommand, ESQLAstQueryExpression, ESQLSource } from '@elastic/esql/types';
import {
  findNamedSubqueryForSource,
  getNamedSubqueriesBefore,
  type NamedSubquery,
} from '../../definitions/utils/named_subqueries';
import { esqlCommandRegistry } from '..';
import type { ESQLColumnData } from '../types';
import { UnmappedFieldsStrategy } from '../types';
import type { IAdditionalFields } from '../registry';

export const columnsAfter = async (
  command: ESQLCommand,
  _previousColumns: ESQLColumnData[], // will always be empty for FROM
  query: string,
  additionalFields: IAdditionalFields,
  unmappedFieldsStrategy: UnmappedFieldsStrategy = UnmappedFieldsStrategy.DEFAULT
) => {
  const options = command.args.filter((arg) => !Array.isArray(arg) && arg.type === 'option');
  const subqueries = command.args.filter(isSubQuery);
  const namedSubqueries = additionalFields.namedSubqueries ?? [];

  const sources: ESQLSource[] = [];
  const referencedNamedSubqueries: NamedSubquery[] = [];
  for (const source of command.args.filter(isSource)) {
    const namedSubquery = findNamedSubqueryForSource(source, namedSubqueries);
    if (namedSubquery) {
      referencedNamedSubqueries.push(namedSubquery);
    } else {
      sources.push(source);
    }
  }

  const promises: Array<Promise<ESQLColumnData[]>> = [];

  // Batch all plain sources into a single FROM s1, s2, ... request instead of N individual
  // ones. ES returns the column-union in one round-trip, which is identical to merging N results.
  if (sources.length > 0) {
    promises.push(additionalFields.fromFrom({ ...command, args: [...sources, ...options] }));
  }

  for (const subquery of subqueries) {
    promises.push(processSubquery(subquery.child, query, additionalFields, unmappedFieldsStrategy));
  }

  // A named subquery body only sees the bindings declared before it.
  for (const namedSubquery of referencedNamedSubqueries) {
    promises.push(
      processSubquery(
        namedSubquery.query,
        query,
        {
          ...additionalFields,
          namedSubqueries: getNamedSubqueriesBefore(namedSubqueries, namedSubquery.command),
        },
        unmappedFieldsStrategy
      )
    );
  }

  const results = await Promise.all(promises);
  return uniqBy(results.flat(), 'name');
};

async function processSubquery(
  subquery: ESQLAstQueryExpression,
  query: string,
  additionalFields: IAdditionalFields,
  unmappedFieldsStrategy: UnmappedFieldsStrategy
): Promise<ESQLColumnData[]> {
  let columns: ESQLColumnData[] = [];

  // Execute each command in subquery pipeline: FROM index | KEEP
  for (const subCommand of subquery.commands) {
    const commandDef = esqlCommandRegistry.getCommandByName(subCommand.name);

    if (commandDef?.methods?.columnsAfter) {
      columns = await commandDef.methods.columnsAfter(
        subCommand,
        columns,
        query,
        additionalFields,
        unmappedFieldsStrategy
      );
    }
  }

  return columns;
}
