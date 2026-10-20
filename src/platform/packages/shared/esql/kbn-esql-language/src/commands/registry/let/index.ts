/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */
import { i18n } from '@kbn/i18n';
import type { ICommand, ICommandMethods } from '../registry';
import type { ICommandContext } from '../types';
import { autocomplete } from './autocomplete';

const letCommandMethods: ICommandMethods<ICommandContext> = {
  autocomplete,
};

export const letCommand: ICommand = {
  // Elasticsearch ships no command definition for snapshot-only commands, so `let` is
  // absent from the generated `Commands` enum.
  name: 'let',
  methods: letCommandMethods,
  metadata: {
    type: 'header' as const,
    description: i18n.translate('kbn-esql-language.esql.definitions.letDoc', {
      defaultMessage: 'Binds a name to a subquery, which can then be referenced with FROM',
    }),
    declaration: 'LET <name> = (<subquery>);',
    examples: [
      'LET top_hosts = (FROM logs | STATS count = COUNT(*) BY host | SORT count DESC | LIMIT 5);\nFROM top_hosts',
      'LET errors = (FROM logs | WHERE level == "error");\nFROM logs | WHERE host IN (FROM errors | KEEP host)',
    ],
    preview: true,
  },
};
