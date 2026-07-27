/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { schema } from '@kbn/config-schema';
import { validate as uuidValidate } from 'uuid';
import { SELECTION_INVESTIGATION_MAX_SCOPE_DEPTH } from '../../common';
import {
  INVESTIGATION_MAX_CONTEXT_STRING_CHARS,
  INVESTIGATION_MAX_FILTERS,
  INVESTIGATION_MAX_QUERY_LENGTH,
  INVESTIGATION_MAX_VALUES_PER_VARIABLE,
} from './constants';

const variableValueSchema = schema.oneOf([
  schema.string({ maxLength: INVESTIGATION_MAX_CONTEXT_STRING_CHARS }),
  schema.number(),
  schema.arrayOf(
    schema.oneOf([
      schema.string({ maxLength: INVESTIGATION_MAX_CONTEXT_STRING_CHARS }),
      schema.number(),
    ]),
    {
      maxSize: INVESTIGATION_MAX_VALUES_PER_VARIABLE,
    }
  ),
]);

export const requestSchema = schema.object({
  requestId: schema.string({
    validate: (value) => (uuidValidate(value) ? undefined : 'requestId must be a UUID'),
  }),
  query: schema.string({ minLength: 1, maxLength: INVESTIGATION_MAX_QUERY_LENGTH }),
  timeField: schema.string({
    minLength: 1,
    maxLength: INVESTIGATION_MAX_CONTEXT_STRING_CHARS,
  }),
  selection: schema.object({
    from: schema.string({ minLength: 1, maxLength: 100 }),
    to: schema.string({ minLength: 1, maxLength: 100 }),
  }),
  filters: schema.arrayOf(schema.object({}, { unknowns: 'allow' }), {
    maxSize: INVESTIGATION_MAX_FILTERS,
  }),
  variables: schema.recordOf(
    schema.string({ minLength: 1, maxLength: 512 }),
    schema.object({
      key: schema.string({ minLength: 1, maxLength: 512 }),
      value: variableValueSchema,
      type: schema.oneOf([
        schema.literal('time_literal'),
        schema.literal('fields'),
        schema.literal('values'),
        schema.literal('multi_values'),
        schema.literal('functions'),
      ]),
    })
  ),
  scopes: schema.maybe(
    schema.arrayOf(
      schema.object({
        field: schema.string({ minLength: 1, maxLength: INVESTIGATION_MAX_CONTEXT_STRING_CHARS }),
        value: schema.nullable(
          schema.oneOf([
            schema.string({ maxLength: INVESTIGATION_MAX_CONTEXT_STRING_CHARS }),
            schema.number(),
            schema.boolean(),
          ])
        ),
        mode: schema.oneOf([schema.literal('equals'), schema.literal('rlike')]),
      }),
      { maxSize: SELECTION_INVESTIGATION_MAX_SCOPE_DEPTH }
    )
  ),
});
