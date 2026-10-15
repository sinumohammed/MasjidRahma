// OpenAPI description of the read-only AI endpoints (/api/ai/*, app.js).
// The AI assistant reads this file to know which calls it may make and what
// each is for - the `summary` and parameter `description` texts are what its
// model chooses by, so they are written for a reader who knows nothing about
// the app. Served at GET /api/ai/openapi.json.
const date = (description) => ({ type: 'string', format: 'date', description });

export const AI_OPENAPI = {
  openapi: '3.0.3',
  info: {
    title: 'Masjid Rahma - read-only API for the AI assistant',
    version: '1.0.0',
    description:
      'Food-duty rotation (each day one member household supplies food), members, dues, ' +
      'income/expense transactions, bank balances and announcements. Dates are in Asia/Kolkata.',
  },
  servers: [{ url: '/api' }],
  paths: {
    '/ai/today-duty': {
      get: {
        operationId: 'today_duty',
        summary: "Today's food-duty member (which household supplies food today), and whether it was swapped",
      },
    },
    '/ai/duty-schedule': {
      get: {
        operationId: 'duty_schedule',
        summary: 'Food-duty schedule day by day, starting today: date, weekday, member, swaps',
        parameters: [
          { name: 'days', in: 'query', required: false, description: 'How many days from today, 1-60 (default 14)', schema: { type: 'integer' } },
        ],
      },
    },
    '/ai/member-duty-days': {
      get: {
        operationId: 'member_duty_days',
        summary: "Every member's food-duty days in each month of a year - for dates beyond the next 60 days, or one member's days",
        parameters: [
          { name: 'year', in: 'query', required: false, description: 'Year, e.g. 2026 (default this year)', schema: { type: 'integer' } },
          { name: 'search', in: 'query', required: false, description: 'Part of a member name or member id, to return only matching members', schema: { type: 'string' } },
        ],
      },
    },
    '/ai/members': {
      get: {
        operationId: 'members',
        summary: 'Members (households): id, name, number of people, rotation or not, active, payment plan',
        parameters: [
          { name: 'search', in: 'query', required: false, description: 'Part of a member name or member id', schema: { type: 'string' } },
        ],
      },
    },
    '/ai/pending-dues': {
      get: {
        operationId: 'pending_dues',
        summary: 'Members who owe dues now: amount due, payment frequency, missed months',
      },
    },
    '/ai/finance-summary': {
      get: {
        operationId: 'finance_summary',
        summary: 'Total income, expense and balance for a date range, totals per category, and current bank account balances',
        parameters: [
          { name: 'startDate', in: 'query', required: false, description: 'First day YYYY-MM-DD (default: all time)', schema: date() },
          { name: 'endDate', in: 'query', required: false, description: 'Last day YYYY-MM-DD (default: all time)', schema: date() },
        ],
      },
    },
    '/ai/transactions': {
      get: {
        operationId: 'transactions',
        summary: 'Income and expense transactions, newest first: date, type, category, amount, description, member, bank',
        parameters: [
          { name: 'startDate', in: 'query', required: false, description: 'First day YYYY-MM-DD', schema: date() },
          { name: 'endDate', in: 'query', required: false, description: 'Last day YYYY-MM-DD', schema: date() },
          { name: 'type', in: 'query', required: false, description: 'Only income or only expense', schema: { type: 'string', enum: ['income', 'expense'] } },
          { name: 'search', in: 'query', required: false, description: 'Part of a category, description or member name', schema: { type: 'string' } },
          { name: 'limit', in: 'query', required: false, description: 'How many, 1-100 (default 30)', schema: { type: 'integer' } },
        ],
      },
    },
    '/ai/announcements': {
      get: {
        operationId: 'announcements',
        summary: 'Announcements sent to all members, newest first',
        parameters: [
          { name: 'limit', in: 'query', required: false, description: 'How many, 1-50 (default 10)', schema: { type: 'integer' } },
        ],
      },
    },
  },
};
