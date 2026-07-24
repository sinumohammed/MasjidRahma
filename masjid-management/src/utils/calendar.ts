// Client-side "add to calendar" helpers - no backend/push infra required.
// The user's own calendar app (Google Calendar, Apple Calendar, Outlook, ...)
// owns the actual reminder/notification once the event is added.

interface ReminderOptions {
  title: string;
  description?: string;
  /** YYYY-MM-DD */
  date: string;
}

const pad = (n: number) => n.toString().padStart(2, '0');

const toYYYYMMDD = (dateStr: string) => dateStr.replace(/-/g, '');

const nextDayYYYYMMDD = (dateStr: string) => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
};

export function buildGoogleCalendarUrl({ title, description, date }: ReminderOptions): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${toYYYYMMDD(date)}/${nextDayYYYYMMDD(date)}`,
  });
  if (description) params.set('details', description);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

const escapeIcsText = (text: string) =>
  text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

export function downloadIcsReminder({ title, description, date }: ReminderOptions): void {
  const start = toYYYYMMDD(date);
  const end = nextDayYYYYMMDD(date);
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const uid = `masjid-rahma-${start}-${Math.random().toString(36).slice(2)}@masjidrahma`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Masjid Rahma//Food Day Reminder//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${start}`,
    `DTEND;VALUE=DATE:${end}`,
    `SUMMARY:${escapeIcsText(title)}`,
    description ? `DESCRIPTION:${escapeIcsText(description)}` : '',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Reminder',
    'TRIGGER:-P1D',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);

  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'reminder'}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
