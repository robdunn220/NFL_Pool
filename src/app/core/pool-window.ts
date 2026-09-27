/**
 * Eastern-time helpers for the pool's weekly rhythm.
 *
 * The NFL schedule is written in US Eastern, and the season crosses the November DST change, so
 * none of this can be done with fixed hour offsets or by adding 86_400_000 to a timestamp — an
 * Eastern "day" is 23 or 25 hours twice a year. Everything here walks the Eastern *calendar* and
 * resolves wall-clock times through Intl, which knows the rules.
 */

const ET = 'America/New_York';

/** Milliseconds the zone is ahead of UTC at a given instant. */
function zoneOffset(ts: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(ts);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // `hour` can format as 24 for midnight in some ICU builds; % 24 normalizes it.
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return asUtc - ts;
}

/** The Eastern calendar date of an instant, as [year, month (1-12), day]. */
export function etDate(ts: number): [number, number, number] {
  const iso = new Date(ts).toLocaleDateString('en-CA', { timeZone: ET });
  const [y, m, d] = iso.split('-').map(Number);
  return [y, m, d];
}

/**
 * Epoch ms of midnight Eastern on the given Eastern calendar date.
 *
 * Resolved in two passes: the first offset is looked up at the wrong instant when the date sits on
 * the far side of a DST change, and the second pass corrects it using the offset actually in
 * force.
 */
export function etMidnight(year: number, month: number, day: number): number {
  const wall = Date.UTC(year, month - 1, day);
  const first = wall - zoneOffset(wall, ET);
  return wall - zoneOffset(first, ET);
}

/**
 * When the week's picks grid stops being public: midnight Eastern at the start of the first
 * Thursday after the deadline.
 *
 * A Sunday 1pm lock therefore keeps the grid up through all of Wednesday and retires it as
 * Thursday begins, which is when the next week's picks open. Returns null when the week has no
 * recorded deadline, meaning "no expiry".
 */
export function gridVisibleUntil(lockAt: number): number | null {
  if (!lockAt) return null;
  const [y, m, d] = etDate(lockAt);
  // A UTC Date used purely as a calendar walker — no DST to trip over while counting days.
  const cursor = new Date(Date.UTC(y, m - 1, d));
  for (let i = 0; i < 8; i++) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (cursor.getUTCDay() === 4) {
      return etMidnight(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate());
    }
  }
  return null;
}

/** Whether the grid should be public right now, given the week's deadline. */
export function isGridVisible(lockAt: number, locked: boolean, now: number): boolean {
  if (!locked) return false;
  const until = gridVisibleUntil(lockAt);
  return until === null || now < until;
}
