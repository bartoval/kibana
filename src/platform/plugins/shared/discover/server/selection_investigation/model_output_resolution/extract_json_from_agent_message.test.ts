/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { extractJsonObjectFromAgentMessage } from './extract_json_from_agent_message';

describe('extractJsonObjectFromAgentMessage', () => {
  it('parses raw JSON objects', () => {
    expect(extractJsonObjectFromAgentMessage('{"answer":{"status":"inconclusive"}}')).toEqual({
      answer: { status: 'inconclusive' },
    });
  });

  it('parses fenced json blocks', () => {
    const message = `Here is the result:\n\`\`\`json\n{"answer":{"status":"supported"}}\n\`\`\``;
    expect(extractJsonObjectFromAgentMessage(message)).toEqual({
      answer: { status: 'supported' },
    });
  });

  it('extracts the first balanced object from surrounding text', () => {
    const message = `Notes {"answer":{"status":"no_signal_found"}} trailing`;
    expect(extractJsonObjectFromAgentMessage(message)).toEqual({
      answer: { status: 'no_signal_found' },
    });
  });

  it('throws when no object is present', () => {
    expect(() => extractJsonObjectFromAgentMessage('not json')).toThrow();
  });
});
