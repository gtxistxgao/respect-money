import { expect, it } from 'vitest';
import { monthRange, today } from '../src/shared/models.js';

it.each([
  ['2026-09-14T06:59:59Z', '2026-09-13'],
  ['2026-09-14T07:00:00Z', '2026-09-14'],
  ['2026-01-01T07:59:59Z', '2025-12-31'],
  ['2026-01-01T08:00:00Z', '2026-01-01'],
  ['2026-03-09T07:00:00Z', '2026-03-09'],
  ['2026-11-02T07:59:59Z', '2026-11-01'],
])('uses the Pacific calendar date at %s', (instant, expected) => {
  expect(today(new Date(instant))).toBe(expected);
});

it('caps the current month at today and keeps historical month ends including leap years', () => {
  const reference = today(new Date('2026-09-14T06:00:00Z'));
  expect(monthRange('2026-09', reference)).toEqual({ start: '2026-09-01', end: '2026-09-13' });
  expect(monthRange('2026-08', reference)).toEqual({ start: '2026-08-01', end: '2026-08-31' });
  expect(monthRange('2024-02', reference)).toEqual({ start: '2024-02-01', end: '2024-02-29' });
  expect(monthRange('2025-02', reference)).toEqual({ start: '2025-02-01', end: '2025-02-28' });
  expect(monthRange('2026-09', '2026-09-01')).toEqual({ start: '2026-09-01', end: '2026-09-01' });
});
