/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import {
  BasicPrettyPrinter,
  Builder,
  Parser,
  Walker,
  isColumn,
  isFunctionExpression,
  isLiteral,
  isSource,
} from '@elastic/esql';
import type { ESQLAstQueryExpression, ESQLCommand } from '@elastic/esql/types';
import type {
  InvestigationScope,
  InvestigationTimeRange,
} from '../../common/selection_investigation';
import { InvestigationError } from './errors';
import {
  cloneCommand,
  createChangeRankingCommands,
  createDocumentCommands,
  createEvidenceKeyFilter,
  createGroupCommand,
  createGroupPatternsCommand,
  createPeriodCommand,
  createTimeFilter,
  createTotalCommand,
} from './esql_commands';
import {
  BASE_QUERY_ALLOWED_COMMANDS,
  INVESTIGATION_MAX_COMPOSED_QUERY_LENGTH,
  INVESTIGATION_MAX_QUERY_LENGTH,
} from './constants';

export const CARDINALITY_COLUMN_PREFIX = 'investigation_cardinality_';

export interface FrozenBaseQuery {
  ast: ESQLAstQueryExpression;
  source: string;
  whereCount: number;
}

export interface ComposedInvestigationQuery {
  query: string;
  documentsQuery: string;
}

export const freezeDiscoverQuery = (query: string): FrozenBaseQuery => {
  if (query.length === 0 || query.length > INVESTIGATION_MAX_QUERY_LENGTH) {
    throw new InvestigationError('query_rejected', 400, 'Discover query length is invalid');
  }
  const result = Parser.parseQuery(query);
  if (result.errors.length > 0) {
    throw new InvestigationError('query_rejected', 400, 'Discover query is not valid ES|QL');
  }

  const commands = [...result.root.commands];
  while (commands.at(-1)?.name === 'sort' || commands.at(-1)?.name === 'limit') {
    commands.pop();
  }
  if (
    commands.length === 0 ||
    commands[0].name !== 'from' ||
    commands.some(({ name }) => !BASE_QUERY_ALLOWED_COMMANDS.has(name))
  ) {
    throw new InvestigationError(
      'query_rejected',
      400,
      'Discover query must have one FROM source followed by row-preserving commands'
    );
  }

  const ast = Builder.expression.query(commands);
  const sources = Walker.matchAll(ast, { type: 'source' }).filter(isSource);
  if (sources.length !== 1 || sources[0].prefix) {
    throw new InvestigationError(
      'query_rejected',
      400,
      'Multiple or cross-cluster ES|QL sources are not supported'
    );
  }
  return {
    ast,
    source: sources[0].name,
    whereCount: commands.filter(({ name }) => name === 'where').length,
  };
};

// Field lists in ES|QL can use `*`, so `host.*` has to count as covering `host.name`. Everything
// other than the star is escaped, otherwise a dot would match any character.
const matchesFieldPattern = (pattern: string, field: string): boolean => {
  if (!pattern.includes('*')) {
    return pattern === field;
  }
  const source = pattern
    .split('*')
    .map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');

  return new RegExp(`^${source}$`).test(field);
};

const validateBasePipelineSemantics = ({
  commands,
  timeField,
  requiredFields,
}: {
  commands: ESQLCommand[];
  timeField: string;
  requiredFields: Set<string>;
}): void => {
  for (const command of commands) {
    const columns = Walker.matchAll(command, { type: 'column' }).filter(isColumn);
    // The two periods come from the chart selection. A time filter in the user's own query would
    // shorten them by different amounts and quietly bias the comparison, so it is refused.
    if (command.name === 'where' && columns.some(({ name }) => name === timeField)) {
      throw new InvestigationError(
        'query_rejected',
        400,
        'The Discover query cannot filter on the time field: the investigation derives the selected and previous periods from the chart selection, and an extra time filter would clip them by different amounts'
      );
    }
    if (
      (command.name === 'eval' || command.name === 'drop' || command.name === 'rename') &&
      (command.name === 'eval'
        ? command.args.some(
            (argument) =>
              isFunctionExpression(argument) &&
              argument.name === '=' &&
              isColumn(argument.args[0]) &&
              requiredFields.has(argument.args[0].name)
          )
        : columns.some(({ name }) =>
            [...requiredFields].some((requiredField) => matchesFieldPattern(name, requiredField))
          ))
    ) {
      throw new InvestigationError(
        'query_rejected',
        400,
        'The Discover query cannot alter fields required by the investigation'
      );
    }
    if (
      command.name === 'keep' &&
      [...requiredFields].some(
        (requiredField) => !columns.some(({ name }) => matchesFieldPattern(name, requiredField))
      )
    ) {
      throw new InvestigationError(
        'query_rejected',
        400,
        'The Discover query must retain fields required by the investigation'
      );
    }
    if (command.name === 'dissect' || command.name === 'grok') {
      const overwritesRequiredField = Walker.matchAll(command, { type: 'literal' })
        .filter(isLiteral)
        .some((literal) => {
          const content =
            'valueUnquoted' in literal ? String(literal.valueUnquoted) : String(literal.value);
          return [...requiredFields].some((field) => content.includes(field));
        });
      if (overwritesRequiredField) {
        throw new InvestigationError(
          'query_rejected',
          400,
          'The Discover query cannot overwrite fields required by the investigation'
        );
      }
    }
  }
};

const printQuery = (commands: ESQLCommand[]): string => {
  const query = BasicPrettyPrinter.multiline(Builder.expression.query(commands), { pipeTab: '' });
  if (query.length > INVESTIGATION_MAX_COMPOSED_QUERY_LENGTH) {
    throw new InvestigationError('query_rejected', 400, 'Composed ES|QL query is too long');
  }
  return query;
};

export const scopeDocumentsQueryToEvidence = ({
  query,
  field,
  value,
  mode = 'equals',
}: {
  query: string;
  field: string;
  value: string | number | boolean | null;
  mode?: 'equals' | 'rlike';
}): string => {
  const parsed = Parser.parseQuery(query);
  if (parsed.errors.length > 0) {
    throw new InvestigationError(
      'query_rejected',
      400,
      'Unable to scope the documents query to evidence'
    );
  }
  const commands = parsed.root.commands.map(cloneCommand);
  const limit = commands.at(-1)?.name === 'limit' ? commands.pop() : undefined;
  const sort = commands.at(-1)?.name === 'sort' ? commands.pop() : undefined;
  return printQuery([
    ...commands,
    createEvidenceKeyFilter(field, value, mode),
    ...(sort ? [sort] : []),
    ...(limit ? [limit] : []),
  ]);
};

export const composeInvestigationQuery = ({
  frozen,
  timeField,
  selection,
  baseline,
  field,
  total,
  categorize = false,
  scopes = [],
}: {
  frozen: FrozenBaseQuery;
  timeField: string;
  selection: InvestigationTimeRange;
  baseline: InvestigationTimeRange;
  field?: string;
  total: boolean;
  categorize?: boolean;
  scopes?: InvestigationScope[];
}): ComposedInvestigationQuery => {
  const union = { from: baseline.from, to: selection.to };
  const baseCommands = frozen.ast.commands.map(cloneCommand);
  const createScopeFilters = () =>
    scopes.map(({ field: scopeField, value, mode }) =>
      createEvidenceKeyFilter(scopeField, value, mode)
    );
  validateBasePipelineSemantics({
    commands: baseCommands.slice(1),
    timeField,
    requiredFields: new Set([
      timeField,
      ...(field ? [field] : []),
      ...scopes.map(({ field: scopeField }) => scopeField),
    ]),
  });
  const comparisonCommands = total
    ? [createTotalCommand()]
    : [
        (categorize ? createGroupPatternsCommand : createGroupCommand)(
          field ??
            (() => {
              throw new InvestigationError(
                'query_rejected',
                400,
                'A grouping field is required for this probe'
              );
            })()
        ),
        ...createChangeRankingCommands(categorize ? 'investigation_pattern' : field!),
      ];
  // Order matters. The time window goes first, right after the source, so nothing downstream can
  // widen it; the selection/baseline label goes last, once the user's own pipeline has run.
  const query = printQuery([
    baseCommands[0],
    createTimeFilter(timeField, union),
    ...baseCommands.slice(1),
    ...createScopeFilters(),
    createPeriodCommand(timeField, selection.from),
    ...comparisonCommands,
  ]);

  // No time filter here: Discover applies the period from its own time picker when the user
  // opens these documents, and baking one in would leak into any later investigation.
  return {
    query,
    documentsQuery: printQuery([
      baseCommands[0],
      ...baseCommands.slice(1),
      ...createScopeFilters(),
      ...createDocumentCommands(timeField),
    ]),
  };
};

export const composeFieldCardinalityQuery = ({
  frozen,
  timeField,
  union,
  fields,
  scopes = [],
}: {
  frozen: FrozenBaseQuery;
  timeField: string;
  union: InvestigationTimeRange;
  fields: string[];
  scopes?: InvestigationScope[];
}): string =>
  // Scoped, so a drill-down measures the population it will actually probe: a field that varies
  // across the whole index can still be constant inside the slice the user picked.
  printQuery([
    cloneCommand(frozen.ast.commands[0]),
    createTimeFilter(timeField, union),
    ...scopes.map(({ field, value, mode }) => createEvidenceKeyFilter(field, value, mode)),
    Builder.command({
      name: 'stats',
      args: fields.map((field, index) =>
        Builder.expression.func.binary('=', [
          Builder.expression.column(`${CARDINALITY_COLUMN_PREFIX}${index}`),
          Builder.expression.func.call('COUNT_DISTINCT', [Builder.expression.column(field)]),
        ])
      ),
    }),
  ]);
