/**
 * Format a timestamp in local calendar time as YYYY-MM-DD.
 */
export function getLocalDateKey(timestampMs = Date.now()) {
  const d = new Date(timestampMs);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Shift a YYYY-MM-DD date string by deltaDays using local calendar math.
 */
export function shiftDateKey(dateKey, deltaDays) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, m - 1, d + deltaDays);
  return getLocalDateKey(dt.getTime());
}

/**
 * Split a [startMs, endMs) interval into per-local-day slices so midnight transitions
 * credit each calendar day accurately.
 */
export function splitIntervalByLocalDay(startMs, endMs) {
  if (!(endMs > startMs)) return [];
  const slices = [];
  let cursor = startMs;

  while (cursor < endMs) {
    const dt = new Date(cursor);
    const nextMidnight = new Date(
      dt.getFullYear(),
      dt.getMonth(),
      dt.getDate() + 1,
      0,
      0,
      0,
      0
    ).getTime();
    const sliceEnd = Math.min(endMs, nextMidnight);
    slices.push({
      dateKey: getLocalDateKey(cursor),
      durationMs: sliceEnd - cursor,
      startMs: cursor,
      endMs: sliceEnd,
    });
    cursor = sliceEnd;
  }

  return slices;
}

/**
 * Format duration milliseconds into human-readable string (e.g., "2h 14m", "4m 32s", "18s").
 */
export function formatDuration(ms, { includeSeconds = true } = {}) {
  if (!ms || ms < 0) return '0s';
  if (ms < 1000) return '<1s';

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (minutes > 0) {
    if (includeSeconds && minutes < 10 && seconds > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

/**
 * Format compact label for charts and small pills (e.g., "2.4h", "38m", "12s").
 */
export function formatCompactDuration(ms) {
  if (!ms || ms < 1000) return '0m';
  const totalMinutes = ms / 60000;
  if (totalMinutes >= 60) {
    return `${(totalMinutes / 60).toFixed(1)}h`;
  }
  if (totalMinutes >= 1) {
    return `${Math.round(totalMinutes)}m`;
  }
  return `${Math.round(ms / 1000)}s`;
}

export function formatRelativeTime(timestampMs, nowMs = Date.now()) {
  if (!timestampMs) return '—';
  const diffSec = Math.max(0, Math.floor((nowMs - timestampMs) / 1000));
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays === 1) return 'yesterday';
  return `${diffDays}d ago`;
}
