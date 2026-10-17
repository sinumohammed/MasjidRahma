// The masjid assistant as a Telegram bot. Telegram sends each message to
// POST /api/telegram/webhook; the bot answers through the same askAssistant
// as the app's chat (app.js), so the roles and daily limits are the same:
//   - a Telegram account linked to a masjid login asks as that login (the
//     admin everything, a member their own dues and payments)
//   - an account that is not linked is a guest: only the food-duty schedule,
//     with the guest limit per Telegram account
// Linking is done by the person themselves, either way:
//   - in the app (Profile, or Settings for the admin): "Connect Telegram"
//     makes a one-time link (10 minutes); opening it sends /start <code>
//   - in the bot: "Share my phone number" - Telegram sends the number of the
//     account itself (we check contact.user_id), matched to members.phone,
//     the number members already log in with. Not for the admin (no member).
// Voice notes are turned into text (transcribeAudio), shown back, then asked.
// Only private chats are answered: in a group, everyone would see the answer.
//
// Set up: TELEGRAM_BOT_TOKEN (from @BotFather), then the admin presses
// "Connect the bot" in Settings (POST /api/telegram/admin/webhook), which
// points Telegram at this server. The webhook's secret is made from the bot
// token, so there is nothing else to set. Without the token: 503, and the app
// hides the Telegram cards.
//
// Serverless: the webhook answers 200 at once and the work runs in
// runInBackground (waitUntil on Vercel). An update seen before is skipped.
import crypto from 'node:crypto';
import express from 'express';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
// The eval points this at a fake Telegram.
const API = (process.env.TELEGRAM_API_URL ?? 'https://api.telegram.org').replace(/\/$/, '');
const WEBHOOK_SECRET = TOKEN ? crypto.createHmac('sha256', TOKEN).update('masjid-telegram-webhook').digest('hex') : null;
const CHANNEL = 'telegram';
const LINK_CODE_MINUTES = 10;
const MAX_VOICE_SECONDS = 120;
const MAX_VOICE_BYTES = 4 * 1024 * 1024;
// Telegram's limit is 4096 characters a message.
const MAX_MESSAGE = 4000;
const VOICE_LANGUAGES = ['English', 'Malayalam', 'Hindi', 'Tamil', 'Kannada', 'Telugu', 'Arabic', 'Urdu'];
// Most of the masjid's members speak Malayalam; /voice changes it.
const DEFAULT_VOICE_LANGUAGE = 'Malayalam';

const sha256hex = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const sameSecret = (a, b) => {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

async function telegram(method, body) {
  const res = await fetch(`${API}/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw Object.assign(new Error(data.description ?? `Telegram ${method}: HTTP ${res.status}`), { status: res.status });
  return data.result;
}

let botUsername = process.env.TELEGRAM_BOT_USERNAME || null;
async function getBotUsername() {
  if (!botUsername && TOKEN) botUsername = (await telegram('getMe')).username;
  return botUsername;
}

// The answer is Markdown; Telegram takes a small set of HTML tags instead.
// Code blocks and tables (a model may still write one) become <pre>.
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function toTelegramHtml(markdown) {
  const blocks = [];
  const keep = (html) => `\uE000${blocks.push(html) - 1}\uE000`;
  let text = String(markdown ?? '').replace(/```[^\n]*\n([\s\S]*?)```/g, (_, code) => keep(`<pre>${escapeHtml(code.trimEnd())}</pre>`));
  text = text.replace(/(?:^\|.*\|[ \t]*(?:\n|$))+/gm, (table) => {
    const rows = table.trimEnd().split('\n').filter((row) => !/^\|[\s:|-]+\|$/.test(row.trim()));
    return keep(`<pre>${escapeHtml(rows.join('\n'))}</pre>`) + '\n';
  });
  text = escapeHtml(text)
    .replace(/`([^`\n]+)`/g, (_, code) => keep(`<code>${code}</code>`))
    .replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/__([^_\n]+)__/g, '<b>$1</b>')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/^(\s*)[-*]\s+/gm, '$1• ');
  return text.replace(/\uE000(\d+)\uE000/g, (_, i) => blocks[Number(i)]);
}

// Long answers in pieces, cut between paragraphs where possible.
function pieces(text) {
  const out = [];
  let rest = text;
  while (rest.length > MAX_MESSAGE) {
    let cut = rest.lastIndexOf('\n\n', MAX_MESSAGE);
    if (cut < MAX_MESSAGE / 2) cut = rest.lastIndexOf('\n', MAX_MESSAGE);
    if (cut < MAX_MESSAGE / 2) cut = MAX_MESSAGE;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  if (rest) out.push(rest);
  return out;
}

// Markdown text to a chat; plain text if Telegram refuses the HTML.
async function reply(chatId, markdown, extra = {}) {
  for (const part of pieces(String(markdown))) {
    try {
      await telegram('sendMessage', { chat_id: chatId, text: toTelegramHtml(part), parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra });
    } catch (error) {
      if (error.status !== 400) throw error;
      await telegram('sendMessage', { chat_id: chatId, text: part, ...extra });
    }
  }
}

const SHARE_PHONE_KEYBOARD = {
  keyboard: [[{ text: '📱 Share my phone number', request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};
const NO_KEYBOARD = { remove_keyboard: true };

const HELP = [
  'Ask me about the masjid - the food-duty schedule, your dues and payments, announcements. You can also send a voice note.',
  '',
  '/whoami - who you are asking as',
  '/new - start a new conversation',
  '/voice - the language of your voice notes',
  '/unlink - stop asking as your masjid login',
].join('\n');

export function telegramRouter(deps) {
  const { dbGet, dbAll, dbRun, requireAuth, requireAdmin, runInBackground, assistantAvailable, askAssistant, usageFor, usedToday, transcribeAudio, forgetConversation, aiUserRef, guestRef } = deps;
  const router = express.Router();
  const configured = () => Boolean(TOKEN) && assistantAvailable();

  // The masjid login a Telegram account asks as, or null (a guest). A member
  // who is no longer active asks as a guest.
  async function linkedUser(telegramId) {
    const row = await dbGet(
      `SELECT u.id, u.username, u.is_admin, u.member_id, m.active, m.name
       FROM channel_links l JOIN users u ON u.id = l.user_id LEFT JOIN members m ON m.id = u.member_id
       WHERE l.channel = $1 AND l.external_id = $2`,
      [CHANNEL, telegramId]
    );
    if (!row || (row.member_id && !row.active)) return null;
    return { id: row.id, username: row.username, isAdmin: Boolean(row.is_admin), memberId: row.member_id ?? null, name: row.name ?? null };
  }

  async function link(telegramId, userId, from) {
    const displayName = [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || null;
    await dbRun(
      `INSERT INTO channel_links (channel, external_id, user_id, display_name) VALUES ($1, $2, $3, $4)
       ON CONFLICT (channel, external_id) DO UPDATE SET user_id = EXCLUDED.user_id, display_name = EXCLUDED.display_name, created_at = CURRENT_TIMESTAMP`,
      [CHANNEL, telegramId, userId, displayName]
    );
  }

  const asWho = (user) => (!user ? 'a guest (only the food-duty schedule)' : user.isAdmin ? `the admin (${user.username})` : `member ${user.username}${user.name ? ` - ${user.name}` : ''}`);
  const conversationOf = (telegramId, user) => (user ? `u-${user.id}-tg` : `tg-${telegramId}`);

  async function voiceLanguage(telegramId) {
    const row = await dbGet('SELECT voice_language FROM channel_prefs WHERE channel = $1 AND external_id = $2', [CHANNEL, telegramId]);
    return row?.voice_language ?? DEFAULT_VOICE_LANGUAGE;
  }

  // /start l_<code>: a one-time link made in the app.
  async function redeemCode(chatId, telegramId, from, code) {
    const row = await dbGet('DELETE FROM channel_link_codes WHERE code_hash = $1 RETURNING user_id, expires_at', [sha256hex(code)]);
    if (!row || new Date(row.expires_at) < new Date()) {
      return reply(chatId, 'That link has expired or was already used. Make a new one in the masjid app (Profile → Telegram).');
    }
    await link(telegramId, row.user_id, from);
    const user = await linkedUser(telegramId);
    return reply(chatId, `Linked ✅ You are now asking as ${asWho(user)}.\n\n${HELP}`, { reply_markup: NO_KEYBOARD });
  }

  // The account's own phone number -> the one active member with it.
  async function linkByPhone(chatId, telegramId, from, contact) {
    if (String(contact.user_id ?? '') !== telegramId) {
      return reply(chatId, 'Please share your own number with the button below.', { reply_markup: SHARE_PHONE_KEYBOARD });
    }
    const digits = (s) => String(s ?? '').replace(/\D/g, '');
    const last10 = (s) => digits(s).slice(-10);
    const wanted = last10(contact.phone_number);
    const rows = await dbAll(
      `SELECT u.id, m.phone FROM members m JOIN users u ON u.member_id = m.id
       WHERE m.active = true AND u.is_admin = false AND m.phone <> ''`
    );
    const matches = wanted.length >= 7 ? rows.filter((r) => last10(r.phone) === wanted) : [];
    if (matches.length === 0) {
      return reply(chatId, "This number is not on the masjid's member list. Ask the admin to check your number, or link from the masjid app (Profile → Telegram). Until then you can ask about the food-duty schedule.", { reply_markup: NO_KEYBOARD });
    }
    if (matches.length > 1) {
      return reply(chatId, 'This number belongs to more than one member, so I cannot tell which one you are. Please link from the masjid app (Profile → Telegram).', { reply_markup: NO_KEYBOARD });
    }
    await link(telegramId, matches[0].id, from);
    const user = await linkedUser(telegramId);
    return reply(chatId, `Linked ✅ You are now asking as ${asWho(user)}.\n\n${HELP}`, { reply_markup: NO_KEYBOARD });
  }

  async function command(chatId, telegramId, from, text) {
    const [name, ...args] = text.split(/\s+/);
    const arg = args.join(' ').trim();
    const cmd = name.slice(1).replace(/@.*$/, '').toLowerCase();
    const user = await linkedUser(telegramId);
    if (cmd === 'start') {
      if (/^l_[A-Za-z0-9_-]{8,60}$/.test(arg)) return redeemCode(chatId, telegramId, from, arg);
      if (user) return reply(chatId, `Assalamu alaikum! You are asking as ${asWho(user)}.\n\n${HELP}`, { reply_markup: NO_KEYBOARD });
      return reply(
        chatId,
        `Assalamu alaikum! I am the masjid's assistant.\n\nMembers: tap *Share my phone number* below to ask about your own dues and payments. Without it you can ask about the food-duty schedule.\n\n${HELP}`,
        { reply_markup: SHARE_PHONE_KEYBOARD }
      );
    }
    if (cmd === 'help') return reply(chatId, HELP);
    if (cmd === 'whoami') {
      return reply(chatId, `You are asking as ${asWho(user)}.${user ? '' : ' Members: /start to link your phone number.'}`, user ? {} : { reply_markup: SHARE_PHONE_KEYBOARD });
    }
    if (cmd === 'new') {
      await forgetConversation(conversationOf(telegramId, user)).catch(() => {});
      return reply(chatId, 'New conversation started.');
    }
    if (cmd === 'unlink') {
      await dbRun('DELETE FROM channel_links WHERE channel = $1 AND external_id = $2', [CHANNEL, telegramId]);
      return reply(chatId, user ? 'Unlinked. You are now a guest: only the food-duty schedule. /start to link again.' : 'This account was not linked.');
    }
    if (cmd === 'voice') {
      const language = VOICE_LANGUAGES.find((l) => l.toLowerCase() === arg.toLowerCase());
      if (!language) {
        return reply(chatId, `Voice notes are read as ${await voiceLanguage(telegramId)}. To change it: /voice ${VOICE_LANGUAGES.join(' | ')}`);
      }
      await dbRun(
        `INSERT INTO channel_prefs (channel, external_id, voice_language) VALUES ($1, $2, $3)
         ON CONFLICT (channel, external_id) DO UPDATE SET voice_language = EXCLUDED.voice_language`,
        [CHANNEL, telegramId, language]
      );
      return reply(chatId, `Voice notes will be read as ${language}.`);
    }
    return reply(chatId, HELP);
  }

  // A question (typed, or a voice note's text) to the assistant.
  async function ask(chatId, telegramId, question) {
    const user = await linkedUser(telegramId);
    // "typing..." lasts 5 seconds; keep it up while the answer is made.
    const typing = () => telegram('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
    typing();
    const timer = setInterval(typing, 4500);
    try {
      const { status, body } = await askAssistant({
        user,
        usage: await usageFor({ user }, `tg:${telegramId}`),
        question,
        conversationId: conversationOf(telegramId, user),
        ref: user ? aiUserRef({ user }) : guestRef(`tg:${telegramId}`),
      });
      if (status !== 200) {
        const hint = status === 429 && !user ? ' Members: /start to link your phone number for your own limit.' : '';
        return reply(chatId, `${body.error ?? 'The assistant could not answer - please try again'}${hint}`);
      }
      const sources = [...new Set((body.sources ?? []).map((s) => s.source).filter(Boolean))];
      // Said only when it is nearly used up.
      const left = body.limit && body.remaining <= 1 ? `\n\n(${body.remaining} of ${body.limit} questions left today)` : '';
      await reply(chatId, `${body.answer}${sources.length ? `\n\nSource: ${sources.join(', ')}` : ''}${left}`.trim());
    } finally {
      clearInterval(timer);
    }
  }

  async function voiceNote(chatId, telegramId, voice) {
    if ((voice.duration ?? 0) > MAX_VOICE_SECONDS || (voice.file_size ?? 0) > MAX_VOICE_BYTES) {
      return reply(chatId, `Please keep voice notes under ${MAX_VOICE_SECONDS / 60} minutes.`);
    }
    const user = await linkedUser(telegramId);
    const usage = await usageFor({ user }, `tg:${telegramId}`);
    if (usage.limit && (await usedToday(usage)) >= usage.limit) {
      return reply(chatId, `You have used today's ${usage.limit} questions - more tomorrow.`);
    }
    telegram('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
    const file = await telegram('getFile', { file_id: voice.file_id });
    const audioRes = await fetch(`${API}/file/bot${TOKEN}/${file.file_path}`, { signal: AbortSignal.timeout(20000) });
    if (!audioRes.ok) return reply(chatId, 'I could not get that voice note - please try again.');
    const audio = Buffer.from(await audioRes.arrayBuffer());
    const { status, body } = await transcribeAudio(audio, voice.mime_type || 'audio/ogg', await voiceLanguage(telegramId));
    if (status !== 200) return reply(chatId, body.error ?? 'Could not turn the voice note into text');
    const text = String(body.text ?? '').trim();
    if (!text) return reply(chatId, 'I could not hear a question in that voice note. (/voice to change its language)');
    await reply(chatId, `🎙 “${text}”`);
    return ask(chatId, telegramId, text.slice(0, 2000));
  }

  async function handleUpdate(update) {
    const message = update.message;
    if (!message?.from || message.from.is_bot) return;
    if (message.chat?.type !== 'private') return;
    const chatId = message.chat.id;
    const telegramId = String(message.from.id);
    try {
      if (message.contact) return await linkByPhone(chatId, telegramId, message.from, message.contact);
      if (message.voice || message.audio) return await voiceNote(chatId, telegramId, message.voice ?? message.audio);
      const text = String(message.text ?? '').trim();
      if (!text) return await reply(chatId, 'Send me a question as text or a voice note.');
      if (text.startsWith('/')) return await command(chatId, telegramId, message.from, text);
      if (text.length > 2000) return await reply(chatId, 'Please ask in up to 2000 characters.');
      return await ask(chatId, telegramId, text);
    } catch (error) {
      console.warn(`Telegram update ${update.update_id}: ${error.message}`);
      await reply(chatId, 'Something went wrong - please try again.').catch(() => {});
    }
  }

  router.post('/webhook', async (req, res) => {
    if (!TOKEN || !sameSecret(req.get('x-telegram-bot-api-secret-token'), WEBHOOK_SECRET)) return res.status(401).json({ error: 'unknown sender' });
    const update = req.body ?? {};
    if (!Number.isSafeInteger(update.update_id)) return res.json({ ok: true });
    try {
      const fresh = await dbGet('INSERT INTO telegram_updates (update_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING update_id', [update.update_id]);
      if (!fresh) return res.json({ ok: true });
      if (update.update_id % 100 === 0) await dbRun("DELETE FROM telegram_updates WHERE received_at < NOW() - INTERVAL '2 days'");
    } catch (error) {
      // 500: Telegram sends it again later.
      return res.status(500).json({ error: error.message });
    }
    res.json({ ok: true });
    if (!configured()) return;
    runInBackground(handleUpdate(update));
  });

  // The person's own Telegram link (Profile / Settings).
  router.get('/link', requireAuth, async (req, res) => {
    if (!configured()) return res.json({ available: false });
    try {
      const links = await dbAll('SELECT display_name, created_at FROM channel_links WHERE channel = $1 AND user_id = $2 ORDER BY created_at', [CHANNEL, req.user.id]);
      res.json({ available: true, botUsername: await getBotUsername(), links: links.map((l) => ({ displayName: l.display_name, createdAt: l.created_at })) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/link-code', requireAuth, async (req, res) => {
    if (!configured()) return res.status(503).json({ error: 'The Telegram bot is not set up' });
    try {
      const code = `l_${crypto.randomBytes(18).toString('base64url')}`;
      const expiresAt = new Date(Date.now() + LINK_CODE_MINUTES * 60000);
      await dbRun('DELETE FROM channel_link_codes WHERE user_id = $1 OR expires_at < NOW()', [req.user.id]);
      await dbRun('INSERT INTO channel_link_codes (code_hash, user_id, expires_at) VALUES ($1, $2, $3)', [sha256hex(code), req.user.id, expiresAt]);
      res.status(201).json({ url: `https://t.me/${await getBotUsername()}?start=${code}`, expiresAt });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete('/link', requireAuth, async (req, res) => {
    try {
      await dbRun('DELETE FROM channel_links WHERE channel = $1 AND user_id = $2', [CHANNEL, req.user.id]);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // The admin's Settings card: is the bot set up and reaching us?
  router.get('/admin', requireAdmin, async (req, res) => {
    if (!TOKEN) return res.json({ configured: false, assistant: assistantAvailable() });
    try {
      const [info, count] = await Promise.all([
        telegram('getWebhookInfo'),
        dbGet('SELECT COUNT(*)::int AS n FROM channel_links WHERE channel = $1', [CHANNEL]),
      ]);
      res.json({
        configured: true,
        assistant: assistantAvailable(),
        botUsername: await getBotUsername(),
        webhookUrl: info.url || null,
        pendingUpdates: info.pending_update_count ?? 0,
        lastError: info.last_error_message ? { message: info.last_error_message, at: new Date(info.last_error_date * 1000).toISOString() } : null,
        linkedAccounts: count?.n ?? 0,
      });
    } catch (error) {
      res.status(502).json({ error: `Telegram: ${error.message}` });
    }
  });

  // Point Telegram at this server (and set the bot's command menu).
  router.post('/admin/webhook', requireAdmin, async (req, res) => {
    if (!TOKEN) return res.status(503).json({ error: 'TELEGRAM_BOT_TOKEN is not set on the server' });
    const url = `${req.protocol}://${req.get('host')}/api/telegram/webhook`;
    try {
      await telegram('setWebhook', { url, secret_token: WEBHOOK_SECRET, allowed_updates: ['message'], drop_pending_updates: true });
      await telegram('setMyCommands', {
        commands: [
          { command: 'start', description: 'Start, or link your phone number' },
          { command: 'whoami', description: 'Who you are asking as' },
          { command: 'new', description: 'Start a new conversation' },
          { command: 'voice', description: 'The language of your voice notes' },
          { command: 'unlink', description: 'Stop asking as your masjid login' },
          { command: 'help', description: 'What I can do' },
        ],
      });
      res.json({ webhookUrl: url, botUsername: await getBotUsername() });
    } catch (error) {
      res.status(502).json({ error: `Telegram: ${error.message}` });
    }
  });

  return router;
}
