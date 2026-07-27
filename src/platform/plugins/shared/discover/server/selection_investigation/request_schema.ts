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
import { SELECTION_INVESTIGATION_MAX_GOAL_LENGTH } from '../../common/selection_investigation';
import {
  INVESTIGATION_MAX_FIELD_VALUE_LENGTH,
  INVESTIGATION_MAX_FILTERS,
  INVESTIGATION_MAX_VARIABLES,
  INVESTIGATION_MAX_VALUES_PER_VARIABLE,
} from './constants';

const variableValueSchema = schema.oneOf([
  schema.string({ maxLength: INVESTIGATION_MAX_FIELD_VALUE_LENGTH }),
  schema.number(),
  schema.arrayOf(
    schema.oneOf([
      schema.string({ maxLength: INVESTIGATION_MAX_FIELD_VALUE_LENGTH }),
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
  goal: schema.string({ minLength: 1, maxLength: SELECTION_INVESTIGATION_MAX_GOAL_LENGTH }),
  query: schema.string({ minLength: 1 }),
  timeField: schema.string({
    minLength: 1,
    maxLength: INVESTIGATION_MAX_FIELD_VALUE_LENGTH,
  }),
  selection: schema.object({
    from: schema.string({ minLength: 1, maxLength: 100 }),
    to: schema.string({ minLength: 1, maxLength: 100 }),
  }),
  filters: schema.arrayOf(schema.object({}, { unknowns: 'allow' }), {
    maxSize: INVESTIGATION_MAX_FILTERS,
  }),
  focus: schema.maybe(
    schema.object({
      title: schema.string({ minLength: 1, maxLength: 100 }),
      summary: schema.string({ minLength: 1, maxLength: 500 }),
      kind: schema.oneOf([
        schema.literal('metric'),
        schema.literal('dimension'),
        schema.literal('pattern'),
      ]),
      dimension: schema.string({
        minLength: 1,
        maxLength: INVESTIGATION_MAX_FIELD_VALUE_LENGTH,
      }),
      value: schema.string({ maxLength: INVESTIGATION_MAX_FIELD_VALUE_LENGTH }),
      selectionValue: schema.number(),
      baselineValue: schema.number(),
      query: schema.string({ minLength: 1 }),
    })
  ),
  variables: schema.arrayOf(
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
    }),
    { maxSize: INVESTIGATION_MAX_VARIABLES }
  ),
});
