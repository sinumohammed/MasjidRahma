// "17 Oct 2026, 6:30 pm" - a message's date, the same on every screen.
export const announcementDate = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
