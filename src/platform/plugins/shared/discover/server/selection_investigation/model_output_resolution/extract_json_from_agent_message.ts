/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

const JSON_FENCE_PATTERN = /```(?:json)?\s*([\s\S]*?)```/i;

const parseJsonObject = (text: string): unknown => {
  const parsed = JSON.parse(text) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object');
  }
  return parsed;
};

const extractBalancedObject = (text: string): string | undefined => {
  const start = text.indexOf('{');
  if (start === -1) {
    return undefined;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return undefined;
};

const collectBalancedObjectCandidates = (text: string): string[] => {
  const results: string[] = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '{') {
      continue;
    }
    const balanced = extractBalancedObject(text.slice(index));
    if (balanced) {
      results.push(balanced);
    }
  }
  return results.sort((left, right) => right.length - left.length);
};

const hasAnswerKey = (value: unknown): boolean =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && 'answer' in value;

/**
 * Pulls a JSON object from Agent Builder handover text (raw JSON, fenced block, or embedded object).
 */
export const extractJsonObjectFromAgentMessage = (messageContent: string): unknown => {
  const trimmed = messageContent.trim();
  if (!trimmed.length) {
    throw new Error('Message content is empty');
  }

  const candidates: string[] = [trimmed];
  const fenceMatch = JSON_FENCE_PATTERN.exec(trimmed);
  if (fenceMatch?.[1]) {
    candidates.push(fenceMatch[1].trim());
  }
  candidates.push(...collectBalancedObjectCandidates(trimmed));

  const seen = new Set<string>();
  const uniqueCandidates = candidates.filter((candidate) => {
    if (!candidate.startsWith('{') || seen.has(candidate)) {
      return false;
    }
    seen.add(candidate);
    return true;
  });

  let lastError: Error | undefined;
  let fallbackParsed: unknown | undefined;

  for (const candidate of uniqueCandidates) {
    try {
      const parsed = parseJsonObject(candidate);
      if (hasAnswerKey(parsed)) {
        return parsed;
      }
      if (fallbackParsed === undefined) {
        fallbackParsed = parsed;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  if (fallbackParsed !== undefined) {
    return fallbackParsed;
  }

  throw lastError ?? new Error('No JSON object found in message content');
};
