/** "3 min ago", "yesterday", "12 Mar" — for timestamps in seconds. */
export function timeAgo(seconds: number | null | undefined, now = Date.now()): string {
  if (!seconds) return "never";
  const diff = Math.max(0, now / 1000 - seconds);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 2 * 86400) return "yesterday";
  if (diff < 30 * 86400) return `${Math.floor(diff / 86400)} days ago`;
  return new Date(seconds * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** "in 23 h", "in 40 min", "expired". */
export function timeLeft(seconds: number | null | undefined, now = Date.now()): string {
  if (seconds == null) return "kept";
  const diff = seconds - now / 1000;
  if (diff <= 0) return "expired";
  if (diff < 3600) return `in ${Math.max(1, Math.round(diff / 60))} min`;
  if (diff < 2 * 86400) return `in ${Math.round(diff / 3600)} h`;
  return `in ${Math.round(diff / 86400)} days`;
}
