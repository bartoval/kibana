/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { Setup } from './helpers';

export const runNamedSubqueriesValidationSuite = (setup: Setup) => {
  describe('Named subqueries (LET) validation', () => {
    describe('references', () => {
      it.each([
        'LET x = (FROM index); FROM x',
        'LET x = (FROM index | LIMIT 10); FROM x | LIMIT 1',
        'LET x = (FROM index); FROM x, other_index',
        'LET x = (FROM index); LET y = (FROM x | LIMIT 1); FROM y',
        'LET x = (ROW a = 1); FROM x | KEEP a',
        'SET time_zone = "UTC"; LET x = (FROM index); FROM x',
        'LET x = (FROM index | KEEP keywordField); FROM index | WHERE keywordField IN (FROM x)',
      ])('accepts a binding referenced with FROM: %s', async (query) => {
        const { expectErrors } = await setup();

        await expectErrors(query, []);
      });

      it('does not resolve unknown names as bindings', async () => {
        const { expectErrors } = await setup();

        await expectErrors('LET x = (FROM index); FROM y', ['Unknown data source "y"']);
      });

      it('does not resolve remote sources as bindings', async () => {
        const { expectErrors } = await setup();

        await expectErrors('LET x = (FROM index); FROM remote:x', [
          'Unknown data source "remote:x"',
        ]);
      });

      it.each([
        ['LET x = (FROM y); LET y = (FROM index); FROM x', 'y'],
        ['LET index = (FROM index); FROM index', 'index'],
        [
          'LET x = (FROM index | WHERE keywordField IN (FROM y)); LET y = (FROM index); FROM x',
          'y',
        ],
      ])('rejects forward references: %s', async (query, name) => {
        const { expectErrors } = await setup();

        await expectErrors(query, [
          `Forward reference in LET bindings: [${name}] cannot be referenced before its declaration`,
        ]);
      });

      it('rejects a binding used as a TS source', async () => {
        const { expectErrors } = await setup();

        await expectErrors('LET x = (FROM index); TS x', [
          'Subqueries are not supported in TS command',
        ]);
      });

      it('rejects a binding used as a LOOKUP JOIN target', async () => {
        const { expectErrors } = await setup();

        await expectErrors('LET x = (FROM index); FROM index | LOOKUP JOIN x ON keywordField', [
          '"x" is not a valid JOIN index. Please use a "lookup" mode index.',
          'Subqueries are not supported in LOOKUP JOIN',
        ]);
      });
    });

    describe('binding names', () => {
      it('rejects duplicate names', async () => {
        const { expectErrors } = await setup();

        await expectErrors('LET x = (FROM index); LET x = (FROM other_index); FROM x', [
          'Duplicate LET binding name [x]',
        ]);
      });

      it('rejects names that are not lowercase', async () => {
        const { expectErrors } = await setup();

        await expectErrors('LET MyBinding = (FROM index); FROM MyBinding', [
          'LET binding name [MyBinding] must be lowercase',
        ]);
      });
    });

    describe('binding subqueries', () => {
      it('validates the commands of a binding', async () => {
        const { expectErrors } = await setup();

        await expectErrors('LET x = (FROM index | KEEP missingField); FROM x', [
          'Unknown column "missingField"',
        ]);
      });

      it('validates the sources of a binding', async () => {
        const { expectErrors } = await setup();

        await expectErrors('LET x = (FROM missingIndex); FROM x', ['Unknown index "missingIndex"']);
      });

      it('validates the FORK branches of a binding', async () => {
        const { expectErrors } = await setup();

        await expectErrors('LET x = (FROM index | FORK (KEEP missingField) (LIMIT 1)); FROM x', [
          'Unknown column "missingField"',
        ]);
      });
    });

    describe('columns', () => {
      it('computes the main query columns from the binding', async () => {
        const { expectErrors } = await setup();

        await expectErrors(
          'LET x = (FROM index | KEEP keywordField); FROM x | KEEP keywordField',
          []
        );
        await expectErrors('LET x = (FROM index | KEEP keywordField); FROM x | KEEP integerField', [
          'Unknown column "integerField"',
        ]);
      });

      it('computes the columns of chained bindings', async () => {
        const { expectErrors } = await setup();

        await expectErrors(
          'LET x = (FROM index | KEEP keywordField, integerField); LET y = (FROM x | DROP integerField); FROM y | KEEP integerField',
          ['Unknown column "integerField"']
        );
      });

      it('computes the columns of IN subqueries referencing a binding', async () => {
        const { expectErrors } = await setup();

        await expectErrors(
          'LET x = (FROM index | KEEP keywordField, integerField); FROM index | WHERE keywordField IN (FROM x)',
          ['The subquery must return 1 column, but returned 2']
        );
      });

      it('does not send the binding name to Elasticsearch', async () => {
        const { validate, callbacks } = await setup();

        await validate('LET x = (FROM index | KEEP keywordField); FROM x | KEEP keywordField');

        const queriesToEs = (callbacks.getColumnsFor as jest.Mock).mock.calls.map(
          ([{ query }]) => query
        );
        expect(queriesToEs).not.toContainEqual(expect.stringMatching(/FROM x\b/));
      });
    });
  });
};
