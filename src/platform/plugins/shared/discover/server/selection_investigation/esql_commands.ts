/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { Builder, Parser, Walker, isParamLiteral } from '@elastic/esql';
import type { ESQLCommand } from '@elastic/esql/types';
import type { InvestigationTimeRange } from '../../common/selection_investigation';
import { InvestigationError } from './errors';

/*
 * Server-owned ES|QL fragments, not hardcoded investigation scenarios. The agent chooses the
 * probe; these commands enforce the selection/baseline comparison, ranking, and document limits.
 * Named parameters are replaced with typed AST nodes, never string concatenation.
 */
const TIME_FILTER_COMMAND =
  'WHERE ??investigation_time_field >= ?investigation_range_from AND ??investigation_time_field < ?investigation_range_to';
const PERIOD_COMMAND =
  'EVAL investigation_period = CASE(??investigation_time_field >= ?investigation_selection_from, "selection", "baseline")';
const TOTAL_COMMAND =
  'STATS selection_count = COUNT(*) WHERE investigation_period == "selection", baseline_count = COUNT(*) WHERE investigation_period == "baseline"';
const GROUP_COMMAND =
  'STATS selection_count = COUNT(*) WHERE investigation_period == "selection", baseline_count = COUNT(*) WHERE investigation_period == "baseline" BY ??investigation_group_by';
const GROUP_PATTERNS_COMMAND =
  'STATS selection_count = COUNT(*) WHERE investigation_period == "selection", baseline_count = COUNT(*) WHERE investigation_period == "baseline" BY investigation_pattern = CATEGORIZE(??investigation_group_by)';
const CHANGE_METRICS_COMMAND =
  'EVAL investigation_delta = selection_count - baseline_count, investigation_absolute_change = ABS(investigation_delta), investigation_positive_change = CASE(investigation_delta > 0, investigation_delta, 0), investigation_negative_change = CASE(investigation_delta < 0, ABS(investigation_delta), 0)';
const CHANGE_MASS_COMMAND =
  'INLINE STATS investigation_positive_mass = SUM(investigation_positive_change), investigation_negative_mass = SUM(investigation_negative_change)';
const CHANGE_SORT_COMMAND = 'SORT investigation_absolute_change DESC, ??investigation_sort_key ASC';
const CHANGE_LIMIT_COMMAND = 'LIMIT 10';
const PATTERN_FILTER_COMMAND = 'WHERE ??investigation_pattern_field RLIKE ?investigation_pattern';
const DOCUMENT_SORT_COMMAND = 'SORT ??investigation_time_field DESC';
const DOCUMENT_LIMIT_COMMAND = 'LIMIT 100';

const parseCommand = (source: string): ESQLCommand => {
  const result = Parser.parseCommand(source);
  if (result.errors.length > 0) {
    throw new InvestigationError('query_rejected', 400, 'Unable to build a guarded ES|QL query');
  }
  return result.root;
};

export const cloneCommand = (command: ESQLCommand): ESQLCommand =>
  structuredClone(command) as ESQLCommand;

const replaceNamedParameter = (
  command: ESQLCommand,
  name: string,
  replacement:
    | ReturnType<typeof Builder.expression.column>
    | ReturnType<typeof Builder.expression.literal.string>
): void => {
  Walker.replaceAll(
    command,
    (node) => isParamLiteral(node) && node.paramType === 'named' && node.value === name,
    replacement
  );
};

export const createTimeFilter = (timeField: string, range: InvestigationTimeRange): ESQLCommand => {
  const command = cloneCommand(parseCommand(TIME_FILTER_COMMAND));
  replaceNamedParameter(command, 'investigation_time_field', Builder.expression.column(timeField));
  replaceNamedParameter(
    command,
    'investigation_range_from',
    Builder.expression.literal.string(range.from)
  );
  replaceNamedParameter(
    command,
    'investigation_range_to',
    Builder.expression.literal.string(range.to)
  );
  return command;
};

export const createPeriodCommand = (timeField: string, selectionFrom: string): ESQLCommand => {
  const command = cloneCommand(parseCommand(PERIOD_COMMAND));
  replaceNamedParameter(command, 'investigation_time_field', Builder.expression.column(timeField));
  replaceNamedParameter(
    command,
    'investigation_selection_from',
    Builder.expression.literal.string(selectionFrom)
  );
  return command;
};

export const createTotalCommand = (): ESQLCommand => cloneCommand(parseCommand(TOTAL_COMMAND));

export const createGroupCommand = (field: string): ESQLCommand => {
  const command = cloneCommand(parseCommand(GROUP_COMMAND));
  replaceNamedParameter(command, 'investigation_group_by', Builder.expression.column(field));
  return command;
};

export const createGroupPatternsCommand = (field: string): ESQLCommand => {
  const command = cloneCommand(parseCommand(GROUP_PATTERNS_COMMAND));
  replaceNamedParameter(command, 'investigation_group_by', Builder.expression.column(field));
  return command;
};

const createChangeSortCommand = (field: string): ESQLCommand => {
  const command = cloneCommand(parseCommand(CHANGE_SORT_COMMAND));
  replaceNamedParameter(command, 'investigation_sort_key', Builder.expression.column(field));
  return command;
};

export const createChangeRankingCommands = (field: string): ESQLCommand[] => [
  cloneCommand(parseCommand(CHANGE_METRICS_COMMAND)),
  cloneCommand(parseCommand(CHANGE_MASS_COMMAND)),
  createChangeSortCommand(field),
  cloneCommand(parseCommand(CHANGE_LIMIT_COMMAND)),
];

export const createDocumentCommands = (timeField: string): ESQLCommand[] => {
  const sort = cloneCommand(parseCommand(DOCUMENT_SORT_COMMAND));
  replaceNamedParameter(sort, 'investigation_time_field', Builder.expression.column(timeField));
  return [sort, cloneCommand(parseCommand(DOCUMENT_LIMIT_COMMAND))];
};

export const createEvidenceKeyFilter = (
  field: string,
  value: string | number | boolean | null,
  mode: 'equals' | 'rlike'
): ESQLCommand => {
  if (mode === 'rlike') {
    if (typeof value !== 'string') {
      throw new InvestigationError(
        'query_rejected',
        400,
        'A categorized evidence key must be a string'
      );
    }
    const command = cloneCommand(parseCommand(PATTERN_FILTER_COMMAND));
    replaceNamedParameter(command, 'investigation_pattern_field', Builder.expression.column(field));
    replaceNamedParameter(
      command,
      'investigation_pattern',
      Builder.expression.literal.string(value)
    );
    return command;
  }
  const column = Builder.expression.column(field);
  const expression =
    value === null
      ? Builder.expression.func.postfix('IS NULL', column)
      : Builder.expression.func.binary('==', [
          column,
          typeof value === 'string'
            ? Builder.expression.literal.string(value)
            : typeof value === 'number'
            ? Number.isInteger(value)
              ? Builder.expression.literal.integer(value)
              : Builder.expression.literal.decimal(value)
            : Builder.expression.literal.boolean(value),
        ]);
  return Builder.command({ name: 'where', args: [expression] });
};
