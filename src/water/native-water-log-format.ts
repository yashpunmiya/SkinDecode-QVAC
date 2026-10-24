/** Native actions are encoded as localDate|actionId for local, exactly-once SQLite sync. */
export function groupPendingWaterLogs(pendingLogs: readonly string[]) {
  const grouped = new Map<string, string[]>();
  for (const entry of pendingLogs) {
    const separator = entry.indexOf('|');
    if (separator <= 0) continue;
    const date = entry.slice(0, separator);
    const actionId = entry.slice(separator + 1);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !actionId) continue;
    grouped.set(date, [...(grouped.get(date) ?? []), actionId]);
  }
  return grouped;
}
