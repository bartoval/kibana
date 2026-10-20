/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */
import { SOURCES_TYPES } from '@kbn/esql-types';
import { setup } from './helpers';

const suggestTexts = async (query: string): Promise<string[]> => {
  const { suggest } = await setup();
  return (await suggest(query)).map(({ text }) => text);
};

describe('autocomplete: named subqueries (LET)', () => {
  describe('LET instruction', () => {
    it('suggests LET at the beginning of the query', async () => {
      expect(await suggestTexts('/')).toContain('LET ');
    });

    it('suggests LET and source commands after a LET instruction', async () => {
      const texts = await suggestTexts('LET x = (FROM index);\n/');

      expect(texts).toEqual(expect.arrayContaining(['LET ', 'FROM ']));
    });

    it('does not suggest LET after a pipe', async () => {
      expect(await suggestTexts('FROM index | /')).not.toContain('LET ');
    });

    it('suggests the assignment after the binding name', async () => {
      expect(await suggestTexts('LET x /')).toEqual(['= ']);
    });

    it('suggests subquery source commands after the assignment', async () => {
      expect(await suggestTexts('LET x = /')).toEqual(
        expect.arrayContaining(['(FROM $0)', '(ROW $0)'])
      );
    });

    it('suggests the semicolon after the binding subquery', async () => {
      expect(await suggestTexts('LET x = (FROM index)/')).toEqual([';\n']);
    });

    it('suggests processing commands within the binding subquery', async () => {
      const texts = await suggestTexts('LET x = (FROM index | /');

      expect(texts).toEqual(expect.arrayContaining(['WHERE ', 'KEEP ']));
      expect(texts).not.toContain('LET ');
    });
  });

  describe('binding names as sources', () => {
    it('suggests bindings declared before the cursor as FROM sources', async () => {
      const { suggest } = await setup();
      const suggestions = await suggest('LET top = (FROM index);\nFROM /');
      const binding = suggestions.find(({ label }) => label === 'top');

      expect(binding).toEqual(expect.objectContaining({ detail: SOURCES_TYPES.NAMED_SUBQUERY }));
    });

    it('suggests earlier bindings within a binding subquery', async () => {
      const texts = await suggestTexts('LET top = (FROM index);\nLET other = (FROM /');

      expect(texts).toContain('top');
      expect(texts).not.toContain('other');
    });

    it('suggests bindings within IN subqueries', async () => {
      expect(
        await suggestTexts('LET top = (FROM index);\nFROM index | WHERE keywordField IN (FROM /')
      ).toContain('top');
    });
  });

  describe('columns', () => {
    it('suggests the columns of the binding in the main query', async () => {
      const texts = await suggestTexts(
        'LET top = (FROM index | KEEP keywordField);\nFROM top | KEEP /'
      );

      expect(texts).toContain('keywordField');
      expect(texts).not.toContain('integerField');
    });

    it('suggests the columns of an earlier binding within a binding subquery', async () => {
      const texts = await suggestTexts(
        'LET top = (FROM index | KEEP keywordField);\nLET other = (FROM top | KEEP /'
      );

      expect(texts).toContain('keywordField');
      expect(texts).not.toContain('integerField');
    });
  });
});
