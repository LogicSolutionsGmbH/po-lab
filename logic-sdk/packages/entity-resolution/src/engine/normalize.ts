/** Name/identifier normalization (ported verbatim from journeys resolve-directory.helper.ts). */

import { LEGAL_SUFFIXES } from '../core/config';

export function stripDiacritics(input: string): string {
  return input.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function stripPunctuation(input: string): string {
  return input.replace(/[^A-Z0-9\s]/gi, ' ');
}

export function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

export function normalizeIdentifier(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Uppercase, strip diacritics/punctuation, collapse spaces (entity name before suffix strip). */
export function prepEntityNameCore(input: string): string {
  return collapseWhitespace(stripPunctuation(stripDiacritics(input.toUpperCase())));
}

export function stripLegalSuffixes(input: string, suffixes: string[] = LEGAL_SUFFIXES): string {
  if (!input.trim()) return input;
  const normalizedInput = collapseWhitespace(input);
  const candidates = suffixes
    .map((suffix) => collapseWhitespace(stripPunctuation(stripDiacritics(suffix.toUpperCase()))))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  let value = normalizedInput;
  for (const suffix of candidates) {
    value = value.replace(new RegExp(`(?:^|\\s)${escapeRegExp(suffix)}$`), '').trim();
  }
  return value;
}

export function normalizeEntityName(input: string, suffixes: string[] = LEGAL_SUFFIXES): string {
  return collapseWhitespace(stripLegalSuffixes(prepEntityNameCore(input), suffixes));
}

export function normalizeCity(input: string): string {
  return collapseWhitespace(stripPunctuation(stripDiacritics(input.toUpperCase())));
}

export function tokenize(value: string): string[] {
  return value ? value.split(/\s+/).filter(Boolean) : [];
}

export function clampScore(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function getTrigrams(str: string): string[] {
  const t: string[] = [];
  for (let i = 0; i <= str.length - 3; i++) t.push(str.slice(i, i + 3));
  return [...new Set(t)];
}
