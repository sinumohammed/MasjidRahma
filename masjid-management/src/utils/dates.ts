// "17 Oct 2026, 6:30 pm" - a message's date, the same on every screen.
export const announcementDate = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });

// "17 Oct 2026" - a transaction's day. Stored dates are YYYY-MM-DD or full
// timestamps (see CLAUDE.md); the first 10 characters are the day either way.
export const shortDate = (value: string) => {
  const d = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
