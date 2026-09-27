import { describe, expect, it } from 'vitest';
import { etDate, etMidnight, gridVisibleUntil, isGridVisible } from './pool-window';

/** 1:00pm Eastern on a given date, as an epoch ms — the usual Sunday lock. */
const SUN_SEP_13_2026_1PM_EDT = Date.parse('2026-09-13T17:00:00Z'); // EDT = UTC-4
const SUN_NOV_01_2026_1PM_EST = Date.parse('2026-11-01T18:00:00Z'); // EST = UTC-5, DST ended 2am

describe('etMidnight', () => {
  it('resolves midnight during daylight time (UTC-4)', () => {
    expect(etMidnight(2026, 9, 17)).toBe(Date.parse('2026-09-17T04:00:00Z'));
  });

  it('resolves midnight during standard time (UTC-5)', () => {
    expect(etMidnight(2026, 11, 5)).toBe(Date.parse('2026-11-05T05:00:00Z'));
  });

  it('resolves midnight on the day the clocks go back', () => {
    // Nov 1 2026 begins at UTC-4; the change happens later that morning.
    expect(etMidnight(2026, 11, 1)).toBe(Date.parse('2026-11-01T04:00:00Z'));
  });
});

describe('etDate', () => {
  it('reads the Eastern calendar date, not the UTC one', () => {
    // 01:30 UTC on the 14th is still the evening of the 13th in New York.
    expect(etDate(Date.parse('2026-09-14T01:30:00Z'))).toEqual([2026, 9, 13]);
  });
});

describe('gridVisibleUntil', () => {
  it('runs a Sunday lock through to the following Thursday midnight', () => {
    expect(gridVisibleUntil(SUN_SEP_13_2026_1PM_EDT)).toBe(Date.parse('2026-09-17T04:00:00Z'));
  });

  it('gets the offset right across the November DST change', () => {
    // Locks Sunday Nov 1 (EDT->EST that morning); expires Thursday Nov 5 at midnight EST.
    expect(gridVisibleUntil(SUN_NOV_01_2026_1PM_EST)).toBe(Date.parse('2026-11-05T05:00:00Z'));
  });

  it('lands on a Thursday in Eastern time, every week of the season', () => {
    // Every Sunday 1pm ET from week 1 through the new year.
    for (let i = 0; i < 20; i++) {
      const sunday = SUN_SEP_13_2026_1PM_EDT + i * 7 * 86_400_000;
      const until = gridVisibleUntil(sunday)!;
      const weekday = new Date(until).toLocaleDateString('en-US', {
        timeZone: 'America/New_York',
        weekday: 'short',
      });
      const time = new Date(until).toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
      });
      expect(`${weekday} ${time}`).toBe('Thu 00:00');
    }
  });

  it('has no expiry when the week records no deadline', () => {
    expect(gridVisibleUntil(0)).toBeNull();
  });
});

describe('isGridVisible', () => {
  const lock = SUN_SEP_13_2026_1PM_EDT;

  it('is hidden before the week locks, even inside the window', () => {
    expect(isGridVisible(lock, false, lock + 3_600_000)).toBe(false);
  });

  it('is visible from the lock through Wednesday night', () => {
    expect(isGridVisible(lock, true, lock)).toBe(true);
    expect(isGridVisible(lock, true, Date.parse('2026-09-16T23:59:00-04:00'))).toBe(true);
  });

  it('retires as Thursday begins', () => {
    expect(isGridVisible(lock, true, Date.parse('2026-09-17T04:00:00Z'))).toBe(false);
    expect(isGridVisible(lock, true, Date.parse('2026-09-17T04:00:01Z'))).toBe(false);
  });

  it('stays up indefinitely when there is no recorded deadline', () => {
    expect(isGridVisible(0, true, Date.now())).toBe(true);
  });
});
