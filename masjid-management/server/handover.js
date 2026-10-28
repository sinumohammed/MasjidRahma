// "Ask a person": a question the assistant could not answer goes to a person
// (Sino, who runs the AI service), and the reply comes back here. The tickets
// live in the AI service (its /api/ask/handover*, with this app's key); this
// server only says which login is asking:
//   - only logged-in users: a guest could not be found again for the reply
//   - each login is "user:<id>" there, the same for the app's chat and the
//     Telegram bot, so a question sent from one is seen in both
//   - the ticket takes the last turns of that chat, so the person sees what
//     was asked and answered
// When the person replies, the AI service posts it to /api/assistant/handover-reply
// (with MASJID_AI_TOKEN, the token it already uses for /api/ai), and a member
// linked on Telegram gets it there at once. The chat reads it anyway.
import express from 'express';

// The person who answers, as the app names them.
export const HANDOVER_PERSON = process.env.HANDOVER_PERSON || 'Sino';

export function handoverApi({ AI_ASK_URL, AI_ASK_KEY, dbGet }) {
  const base = String(AI_ASK_URL ?? '').replace(/\/$/, '');
  const refOf = (user) => `user:${user.id}`;

  async function call(method, path, body) {
    try {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${AI_ASK_KEY}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20000),
      });
      const data = await res.json().catch(() => ({}));
      return { status: res.ok ? 200 : res.status === 404 || res.status === 400 || res.status === 429 ? res.status : 502, body: res.ok ? data : { error: data.error ?? 'Could not reach a person just now - please try again' } };
    } catch {
      return { status: 502, body: { error: 'Could not reach a person just now - please try again' } };
    }
  }

  // The name the person sees: the member's name, or the admin's login.
  async function nameOf(user) {
    if (user.memberId) {
      const row = await dbGet('SELECT name FROM members WHERE id = $1', [user.memberId]).catch(() => null);
      if (row?.name) return row.name;
    }
    return user.username ?? null;
  }
  const roleOf = (user) => (user.isAdmin ? 'admin' : 'member');

  return {
    refOf,
    // question: the one the assistant could not answer - the AI service takes the chat's last one when it is left out.
    create: async (user, { conversationId, question, note, reason }) =>
      call('POST', '/handover', {
        user: { ref: refOf(user), name: await nameOf(user), role: roleOf(user) },
        conversationId,
        ...(question ? { question } : {}),
        ...(note ? { note } : {}),
        ...(reason ? { reason } : {}),
      }),
    list: (user) => call('GET', `/handovers?user=${encodeURIComponent(refOf(user))}`),
    addMessage: (user, id, text) => call('POST', `/handovers/${encodeURIComponent(id)}/messages`, { user: { ref: refOf(user) }, text }),
    seen: (user, id) => call('POST', `/handovers/${encodeURIComponent(id)}/seen`, { user: { ref: refOf(user) } }),
  };
}

export function handoverRouter({ api, requireAuth, conversationFor, chatIdPattern, aiTokenMatches, notifyUser }) {
  const router = express.Router();
  const send = (res, { status, body }) => res.status(status).json(body);
  const textOf = (v) => String(v ?? '').trim();

  router.post('/handover', requireAuth, async (req, res) => {
    const chatId = String(req.body?.chatId ?? 'main');
    if (!chatIdPattern.test(chatId)) return res.status(400).json({ error: 'Invalid chatId' });
    const question = textOf(req.body?.question);
    const note = textOf(req.body?.note);
    if (question.length > 2000 || note.length > 2000) return res.status(400).json({ error: 'Please write up to 2000 characters' });
    const reason = ['not_found', 'app_failed'].includes(req.body?.reason) ? req.body.reason : undefined;
    send(res, await api.create(req.user, { conversationId: conversationFor(req, chatId), question: question || undefined, note: note || undefined, reason }));
  });

  router.get('/handovers', requireAuth, async (req, res) => send(res, await api.list(req.user)));

  router.post('/handovers/:id/messages', requireAuth, async (req, res) => {
    const text = textOf(req.body?.text);
    if (!text || text.length > 2000) return res.status(400).json({ error: 'Write a message of up to 2000 characters' });
    send(res, await api.addMessage(req.user, req.params.id, text));
  });

  router.post('/handovers/:id/seen', requireAuth, async (req, res) => send(res, await api.seen(req.user, req.params.id)));

  // From the AI service: the person replied. A member linked on Telegram gets it there.
  router.post('/handover-reply', express.json({ limit: '64kb' }), async (req, res) => {
    if (!aiTokenMatches(req)) return res.status(401).json({ error: 'AI access token required' });
    const userId = String(req.body?.user?.ref ?? '').match(/^user:(.+)$/)?.[1];
    const text = textOf(req.body?.text);
    if (!userId || !text) return res.status(400).json({ error: 'user.ref "user:<id>" and text are needed' });
    try {
      const delivered = await notifyUser(userId, { ticketId: req.body.ticketId, question: textOf(req.body.question), text });
      res.json({ delivered });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
