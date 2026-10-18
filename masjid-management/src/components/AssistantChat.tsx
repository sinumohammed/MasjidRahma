import { useEffect, useRef, useState, type ReactNode } from 'react';
import AnswerActions from './AnswerActions';
import { Input, Button, Alert, Tag, Popconfirm, Select, Switch, Tooltip, ConfigProvider, message } from 'antd';
import {
  SendOutlined,
  ClearOutlined,
  AudioOutlined,
  CheckOutlined,
  CloseOutlined,
  HistoryOutlined,
  CoffeeOutlined,
  CalendarOutlined,
  ScheduleOutlined,
  WalletOutlined,
  FileSearchOutlined,
  CreditCardOutlined,
  NotificationOutlined,
  BarChartOutlined,
  LineChartOutlined,
  PieChartOutlined,
  TeamOutlined,
  BankOutlined,
} from '@ant-design/icons';
import AssistantIcon from './AssistantIcon';
import AssistantAnswer from './AssistantAnswer';
import { isWideAnswer } from './answerFormat';
import {
  askAssistant,
  clearAssistantChat,
  getAssistantStatus,
  AssistantError,
  type AssistantSource,
  type AssistantQuota,
  type AssistantStatus,
} from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useVoiceRecorder, voiceSupported } from './useVoiceRecorder';
import { useFitToViewport } from './useFitToViewport';
import './AssistantChat.css';

// Ask questions about the masjid's data in plain words. The server asks the
// AI service for the logged-in user (server: /api/assistant/ask), and the AI
// answers from this app's data as that user may see it: the admin sees
// everything, a member the schedule, announcements and their own dues and
// payments; a visitor who is not logged in, only the food-duty schedule.
// The conversation is remembered on the AI side (24 hours); this screen keeps
// its own copy per account in localStorage, to show it again, and the
// account's recent questions to ask again with one tap. Questions are limited
// per day (server: AI_DAILY_LIMIT_*); the count left is shown at the top.
// Questions can be spoken (useVoiceRecorder), in any language.

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  sources?: AssistantSource[];
  error?: boolean;
  // When it was sent or answered (ms); messages kept from before have none.
  at?: number;
}

// Under each message: the time today, "Yesterday 6:32 PM", else the date;
// the full date and time on hover or tap. In the device's language and clock.
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const dateYearFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const fullFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' });
const dayStart = (t: number) => new Date(t).setHours(0, 0, 0, 0);
function messageTime(at: number): string {
  const days = Math.round((dayStart(Date.now()) - dayStart(at)) / 86400000);
  if (days === 0) return timeFmt.format(at);
  if (days === 1) return `Yesterday ${timeFmt.format(at)}`;
  const day = new Date(at).getFullYear() === new Date().getFullYear() ? dateFmt.format(at) : dateYearFmt.format(at);
  return `${day}, ${timeFmt.format(at)}`;
}
function MessageTime({ at }: { at?: number }) {
  const [full, setFull] = useState(false);
  if (!at) return null;
  return (
    <time className="assistant-time" dateTime={new Date(at).toISOString()} title={fullFmt.format(at)} onClick={() => setFull((f) => !f)}>
      {full ? fullFmt.format(at) : messageTime(at)}
    </time>
  );
}

const MAX_KEPT = 40;
const MAX_RECENT = 6;
const VOICE_LANGUAGE_KEY = 'masjid_assistant_voice_language';
const AUTO_SEND_KEY = 'masjid_assistant_voice_auto_send';
// Shown in its own script, so each speaker finds theirs.
const VOICE_LANGUAGES = [
  { value: 'auto', label: 'Any language' },
  { value: 'Malayalam', label: 'മലയാളം' },
  { value: 'English', label: 'English' },
  { value: 'Hindi', label: 'हिन्दी' },
  { value: 'Tamil', label: 'தமிழ்' },
  { value: 'Arabic', label: 'العربية' },
  { value: 'Urdu', label: 'اردو' },
];
const GUEST_CHAT_KEY = 'masjid_assistant_guest_chat_id';

// A logged-in user's chat is theirs on the server ("main"); a guest's is
// known only by a random id kept in this browser, so guests never share one.
function chatIdFor(isLoggedIn: boolean): string {
  if (isLoggedIn) return 'main';
  try {
    let id = window.localStorage.getItem(GUEST_CHAT_KEY);
    if (!id) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
      window.localStorage.setItem(GUEST_CHAT_KEY, id);
    }
    return id;
  } catch {
    return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
  }
}
const storageKey = (user: string | null) => `masjid_assistant_chat_${user || 'anonymous'}`;

function loadMessages(user: string | null): ChatMessage[] {
  try {
    const raw = window.localStorage.getItem(storageKey(user));
    return raw ? (JSON.parse(raw) as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

function saveMessages(user: string | null, messages: ChatMessage[]) {
  try {
    window.localStorage.setItem(storageKey(user), JSON.stringify(messages.slice(-MAX_KEPT)));
  } catch {
    // storage full or blocked: the chat still works, it just isn't kept
  }
}

const recentKey = (user: string | null) => `masjid_assistant_recent_${user || 'anonymous'}`;
function loadRecent(user: string | null): string[] {
  try {
    return JSON.parse(window.localStorage.getItem(recentKey(user)) ?? '[]') as string[];
  } catch {
    return [];
  }
}
// The newest first, each question once (ignoring case and spaces).
function rememberQuestion(user: string | null, recent: string[], q: string): string[] {
  const norm = (x: string) => x.toLowerCase().replace(/\s+/g, ' ').trim();
  const next = [q, ...recent.filter((r) => norm(r) !== norm(q))].slice(0, MAX_RECENT);
  try {
    window.localStorage.setItem(recentKey(user), JSON.stringify(next));
  } catch {
    // not kept - still shown for now
  }
  return next;
}
// Spoken questions are sent as soon as they are written out, unless the user
// turned that off to check the words first (a misheard question still counts).
function loadAutoSend(): boolean {
  try {
    return window.localStorage.getItem(AUTO_SEND_KEY) !== 'off';
  } catch {
    return true;
  }
}

function loadVoiceLanguage(): string {
  try {
    return window.localStorage.getItem(VOICE_LANGUAGE_KEY) || 'auto';
  } catch {
    return 'auto';
  }
}

// "masjid API: GET /ai/duty-on-date?date=..." means nothing to a member: the
// app's own data is shown as its records; anything else by its section.
function sourceLabel(s: AssistantSource): string {
  return s.source === 'masjid API' ? 'Masjid records' : s.section ?? s.source;
}

// Ready questions, in Malayalam - most members ask in Malayalam, and the
// assistant answers in the language of the question. Each one is what that
// role can see: a guest only the food-duty schedule, a member their own dues
// and payments, the admin the accounts and everyone's dues.
interface Suggestion {
  icon: ReactNode;
  tone: 'teal' | 'amber' | 'indigo' | 'rose' | 'sky' | 'violet';
  label: string;
  question: string;
}
const TODAY_DUTY: Suggestion = { icon: <CoffeeOutlined />, tone: 'teal', label: 'ഇന്നത്തെ ഭക്ഷണ ഡ്യൂട്ടി', question: 'ഇന്ന് ഭക്ഷണം നൽകുന്നത് ആരാണ്?' };
const GUEST_SUGGESTIONS: Suggestion[] = [
  TODAY_DUTY,
  { icon: <CalendarOutlined />, tone: 'amber', label: 'നാളത്തെ ഡ്യൂട്ടി', question: 'നാളെ ഭക്ഷണ ഡ്യൂട്ടി ആർക്കാണ്?' },
  { icon: <ScheduleOutlined />, tone: 'indigo', label: 'ഈ ആഴ്ചത്തെ ഡ്യൂട്ടി', question: 'ഈ ആഴ്ചത്തെ ഭക്ഷണ ഡ്യൂട്ടി ലിസ്റ്റ് കാണിക്കൂ' },
  { icon: <CalendarOutlined />, tone: 'sky', label: 'വെള്ളിയാഴ്ച ഡ്യൂട്ടി', question: 'ഈ വെള്ളിയാഴ്ച ഭക്ഷണ ഡ്യൂട്ടി ആർക്കാണ്?' },
];
const MEMBER_SUGGESTIONS: Suggestion[] = [
  { icon: <WalletOutlined />, tone: 'rose', label: 'എന്റെ ബാക്കി തുക', question: 'എനിക്ക് അടയ്ക്കാൻ ബാക്കിയുള്ള തുക എത്ര?' },
  { icon: <CalendarOutlined />, tone: 'amber', label: 'എന്റെ അടുത്ത ഡ്യൂട്ടി', question: 'എന്റെ അടുത്ത ഭക്ഷണ ഡ്യൂട്ടി എന്നാണ്?' },
  { icon: <FileSearchOutlined />, tone: 'violet', label: 'കഴിഞ്ഞ വർഷത്തെ ബാക്കി', question: 'കഴിഞ്ഞ വർഷം എനിക്ക് അടയ്ക്കാൻ ബാക്കിയുണ്ടായിരുന്നോ?' },
  { icon: <CreditCardOutlined />, tone: 'sky', label: 'എന്റെ പേയ്മെന്റുകൾ', question: 'ഞാൻ അവസാനം അടച്ച പേയ്മെന്റുകൾ കാണിക്കൂ' },
  { icon: <NotificationOutlined />, tone: 'indigo', label: 'പുതിയ അറിയിപ്പ്', question: 'ഏറ്റവും പുതിയ അറിയിപ്പ് എന്താണ്?' },
  TODAY_DUTY,
];
const ADMIN_SUGGESTIONS: Suggestion[] = [
  { icon: <BarChartOutlined />, tone: 'indigo', label: 'കഴിഞ്ഞ മാസത്തെ കണക്ക്', question: 'കഴിഞ്ഞ മാസത്തെ ആകെ വരവും ചെലവും എത്ര?' },
  { icon: <PieChartOutlined />, tone: 'amber', label: 'ഈ മാസത്തെ ചെലവ്', question: 'ഈ മാസം ഇതുവരെ എത്ര ചെലവായി, ഏതൊക്കെ ഇനങ്ങളിൽ?' },
  { icon: <TeamOutlined />, tone: 'rose', label: 'ബാക്കിയുള്ള അംഗങ്ങൾ', question: 'വരിസംഖ്യ അടയ്ക്കാൻ ബാക്കിയുള്ള അംഗങ്ങൾ ആരൊക്കെ, എത്ര വീതം?' },
  { icon: <FileSearchOutlined />, tone: 'violet', label: 'കഴിഞ്ഞ വർഷത്തെ ബാക്കി', question: 'കഴിഞ്ഞ വർഷത്തെ വരിസംഖ്യ ബാക്കിയുള്ളവർ ആരൊക്കെ?' },
  { icon: <BankOutlined />, tone: 'sky', label: 'ബാങ്ക് ബാലൻസ്', question: 'ബാങ്ക് അക്കൗണ്ടുകളിലെ ഇപ്പോഴത്തെ ബാലൻസ് എത്ര?' },
  { icon: <LineChartOutlined />, tone: 'teal', label: 'കഴിഞ്ഞ 30 ദിവസം', question: 'കഴിഞ്ഞ 30 ദിവസത്തെ വരവും ചെലവും ദിവസം തിരിച്ച് ലൈൻ ചാർട്ടായി കാണിക്കൂ' },
  { icon: <LineChartOutlined />, tone: 'amber', label: 'ഈ വർഷത്തെ വരവ്-ചെലവ്', question: 'ഈ വർഷത്തെ വരവും ചെലവും മാസം തിരിച്ച് ലൈൻ ചാർട്ടായി കാണിക്കൂ' },
  TODAY_DUTY,
];

// The assistant's own accent - the green of its icon - inside the chat only;
// the rest of the app keeps its theme (light and dark come from the app).
// The app's theme (src/theme.ts) - nothing of its own any more.
const CHAT_THEME = {};

// `embedded`: inside the floating chat's drawer; `onClose` closes it.
// One answer: the text, its sources, and copy / image / print (AnswerActions).
function AnswerBubble({ m }: { m: ChatMessage }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} className={`assistant-bubble is-assistant${!m.error && isWideAnswer(m.text) ? ' is-wide' : ''}`}>
      {m.error ? <Alert type="warning" showIcon message={m.text} /> : <AssistantAnswer text={m.text} />}
      {m.sources && m.sources.length > 0 && (
        <div className="assistant-sources">
          <span className="assistant-sources-label">From:</span>
          {[...new Set(m.sources.map(sourceLabel))].map((label) => (
            <Tag key={label} className="assistant-source" bordered={false}>
              {label}
            </Tag>
          ))}
        </div>
      )}
      <div className="assistant-answer-foot">
        {!m.error && <AnswerActions text={m.text} target={ref} />}
        <MessageTime at={m.at} />
      </div>
    </div>
  );
}

export default function AssistantChat({ embedded = false, onClose }: { embedded?: boolean; onClose?: () => void }) {
  const { isAdmin, isLoggedIn, username } = useAuth();
  const account = isLoggedIn ? username : null;
  const [chatId, setChatId] = useState(() => chatIdFor(isLoggedIn));
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadMessages(account));
  const [draft, setDraft] = useState('');
  const [asking, setAsking] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [recent, setRecent] = useState<string[]>(() => loadRecent(account));
  const [quota, setQuota] = useState<AssistantQuota | null>(null);
  const [askingAs, setAskingAs] = useState<AssistantStatus['askingAs']>();
  const [voiceLanguage, setVoiceLanguage] = useState(loadVoiceLanguage);
  const [autoSend, setAutoSend] = useState(loadAutoSend);
  const shellRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const noneLeft = quota?.remaining === 0;
  // The chat ends at the bottom of the visible screen (above the keyboard on a
  // phone); on the page, a little space is left below it.
  // 200 px at the least: with the keyboard open a phone has about that much.
  const fitHeight = useFitToViewport(shellRef, { bottomGap: embedded ? 0 : 16, min: 200, aboveBottomNav: !embedded });

  // The recording stops by itself when the speaker pauses; with auto-send the
  // words go straight out as the question (shown as the user's bubble).
  const voice = useVoiceRecorder({
    language: voiceLanguage,
    onText: (text) => {
      if (autoSend && !draft.trim()) ask(text);
      else setDraft((d) => (d.trim() ? `${d.trim()} ${text}` : text));
    },
    onError: (msg) => message.warning(msg),
  });

  // Logging in or out switches to that account's chat, recent questions and count.
  useEffect(() => {
    setChatId(chatIdFor(isLoggedIn));
    setMessages(loadMessages(account));
    setRecent(loadRecent(account));
    let cancelled = false;
    getAssistantStatus()
      .then((s) => {
        if (cancelled) return;
        setQuota(s.limit !== undefined ? { limit: s.limit ?? null, remaining: s.remaining ?? null } : null);
        setAskingAs(s.askingAs);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, account]);

  // Keep the newest message in view - scrolling the list only: scrollIntoView
  // also scrolled the whole page on phones.
  useEffect(() => {
    saveMessages(account, messages);
    // An empty chat shows the welcome from its top.
    const list = listRef.current;
    if (list && messages.length) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
  }, [messages, account, asking]);

  const suggestions = !isLoggedIn ? GUEST_SUGGESTIONS : isAdmin ? ADMIN_SUGGESTIONS : MEMBER_SUGGESTIONS;

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || asking || noneLeft) return;
    setDraft('');
    setMessages((m) => [...m, { role: 'user', text: q, at: Date.now() }]);
    setRecent((r) => rememberQuestion(account, r, q));
    setAsking(true);
    try {
      const { answer, sources, limit, remaining } = await askAssistant(q, chatId);
      setMessages((m) => [...m, { role: 'assistant', text: answer, sources, at: Date.now() }]);
      setQuota({ limit, remaining });
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', text: err instanceof Error ? err.message : 'The assistant could not answer', error: true, at: Date.now() }]);
      if (err instanceof AssistantError && err.quota) setQuota(err.quota);
    } finally {
      setAsking(false);
    }
  };

  const clearChat = async () => {
    setClearing(true);
    try {
      await clearAssistantChat(chatId);
    } catch {
      // the local copy is cleared anyway; the AI side forgets it within 24 hours
    } finally {
      setMessages([]);
      setClearing(false);
    }
  };

  const clearButton = messages.length > 0 && (
    <Popconfirm title="Clear this chat?" onConfirm={clearChat} okText="Clear" cancelText="Cancel">
      <Button type="text" shape="circle" icon={<ClearOutlined />} loading={clearing} aria-label="Clear chat" />
    </Popconfirm>
  );

  // "3 of 4 left today" - nothing when there is no limit (the admin).
  const quotaPill = quota?.limit ? (
    <span className={`assistant-quota${noneLeft ? ' is-out' : quota.remaining! <= 1 ? ' is-low' : ''}`} title="Questions left today">
      {noneLeft ? 'None left today' : `${quota.remaining} of ${quota.limit} left`}
    </span>
  ) : null;

  const askingAsText = askingAs
    ? askingAs.role === 'admin'
      ? 'Admin · everything'
      : askingAs.role === 'member'
        ? `${askingAs.username} · your own dues`
        : 'Guest · log in for more'
    : 'Masjid Rahma';

  const setLanguage = (value: string) => {
    setVoiceLanguage(value);
    try {
      window.localStorage.setItem(VOICE_LANGUAGE_KEY, value);
    } catch {
      // not kept
    }
  };
  const busy = asking || voice.status !== 'idle';
  const showVoice = voiceSupported();

  return (
    <ConfigProvider theme={CHAT_THEME}>
    <div
      ref={shellRef}
      // Little room (a phone with the keyboard open): only the composer below the messages.
      className={`assistant-shell${embedded ? ' assistant-embedded' : ''}${fitHeight && fitHeight < 440 ? ' is-tight' : ''}`}
      style={fitHeight ? { height: fitHeight } : undefined}
    >
      {/* Header: who answers, as whom, questions left, clear, close. */}
      <div className="assistant-head">
        <span className="assistant-head-avatar">
          <AssistantIcon size={embedded ? 36 : 40} />
          <span className="assistant-online" aria-hidden />
        </span>
        <div className="assistant-head-text">
          <div className="assistant-head-title">
            Masjid Assistant <span className="assistant-ai-badge">AI</span>
          </div>
          <div className="assistant-head-sub">{askingAsText}</div>
        </div>
        {quotaPill}
        {clearButton}
        {onClose && <Button type="text" shape="circle" icon={<CloseOutlined />} onClick={onClose} aria-label="Close the assistant" />}
      </div>

      <div className="assistant-messages" ref={listRef}>
        {messages.length === 0 && (
          <div className="assistant-empty">
            <span className="assistant-empty-avatar">
              <AssistantIcon size={64} />
            </span>
            <div className="assistant-empty-greeting">അസ്സലാമു അലൈക്കും</div>
            <div className="assistant-empty-title">How can I help you today?</div>
            <div className="assistant-empty-text">
              {!isLoggedIn
                ? 'Ask who is on food duty today, tomorrow or any day this year. Log in to ask about dues and more.'
                : isAdmin
                  ? 'Accounts, dues, members, the food-duty schedule and announcements - ask in Malayalam or English.'
                  : 'Your dues and payments, your food-duty days and announcements - ask in Malayalam or English.'}
            </div>
            <div className="assistant-chip-label">ചോദിച്ചു നോക്കൂ</div>
            <div className="assistant-prompts">
              {suggestions.map((s) => (
                <button type="button" key={s.label} className={`assistant-prompt tone-${s.tone}`} onClick={() => ask(s.question)} disabled={busy || noneLeft}>
                  <span className="assistant-prompt-icon" aria-hidden>
                    {s.icon}
                  </span>
                  <span className="assistant-prompt-text">
                    <span className="assistant-prompt-label">{s.label}</span>
                    <span className="assistant-prompt-question">{s.question}</span>
                  </span>
                </button>
              ))}
            </div>
            {recent.length > 0 && (
              <>
                <div className="assistant-chip-label">
                  <HistoryOutlined /> Your recent questions
                </div>
                <div className="assistant-chips">
                  {recent.map((s) => (
                    <button type="button" key={s} className="assistant-chip is-recent" onClick={() => ask(s)} disabled={busy || noneLeft}>
                      {s}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="assistant-row is-user">
              <div className="assistant-bubble is-user">
                {m.text}
                <MessageTime at={m.at} />
              </div>
            </div>
          ) : (
            <div key={i} className="assistant-row is-assistant">
              <span className="assistant-avatar">
                <AssistantIcon size={30} />
              </span>
              <AnswerBubble m={m} />
            </div>
          )
        )}
        {asking && (
          <div className="assistant-row is-assistant" aria-live="polite">
            <span className="assistant-avatar">
              <AssistantIcon size={30} />
            </span>
            <div className="assistant-bubble is-assistant assistant-typing" aria-label="Looking it up">
              <span className="assistant-typing-dots">
                <span />
                <span />
                <span />
              </span>
              <span className="assistant-typing-text">Checking the masjid records…</span>
            </div>
          </div>
        )}
      </div>

      {/* Bottom, always in view: recent questions, the limit note, the composer. */}
      <div className="assistant-bottom">
        {/* After the first question: the ready questions as one scrolling row
            of chips, then the user's own recent ones. */}
        {messages.length > 0 && voice.status === 'idle' && !noneLeft && (
          <div className="assistant-recent-row" aria-label="Quick questions">
            {suggestions.map((s) => (
              <button type="button" key={s.label} className={`assistant-chip is-quick tone-${s.tone}`} onClick={() => ask(s.question)} disabled={busy} title={s.question}>
                <span className="assistant-chip-icon" aria-hidden>
                  {s.icon}
                </span>
                {s.label}
              </button>
            ))}
            {recent
              .filter((r) => !suggestions.some((s) => s.question === r))
              .map((r) => (
                <button type="button" key={r} className="assistant-chip is-recent" onClick={() => ask(r)} disabled={busy} title={r}>
                  <HistoryOutlined className="assistant-chip-icon" />
                  {r}
                </button>
              ))}
          </div>
        )}
        {noneLeft && (
          <Alert
            className="assistant-limit"
            type="info"
            showIcon
            message={isLoggedIn ? "You have used today's questions - ask again tomorrow." : "You have used today's questions - log in, or ask again tomorrow."}
          />
        )}
        <div className={`assistant-composer${voice.status === 'recording' ? ' is-recording' : ''}`}>
          {voice.status === 'recording' ? (
            <>
              <span className="assistant-rec-dot" aria-hidden />
              <span className="assistant-rec-time">
                Listening… {Math.floor(voice.seconds / 60)}:{String(voice.seconds % 60).padStart(2, '0')}
                <span className="assistant-rec-hint"> · pause to finish</span>
              </span>
              <Button type="text" shape="circle" icon={<CloseOutlined />} onClick={voice.cancel} aria-label="Cancel recording" />
              <Button type="primary" shape="circle" icon={<CheckOutlined />} onClick={voice.stop} aria-label="Done speaking" />
            </>
          ) : (
            <>
              <Input.TextArea
                className="assistant-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onPressEnter={(e) => {
                  if (!e.shiftKey) {
                    e.preventDefault();
                    ask(draft);
                  }
                }}
                placeholder={voice.status === 'transcribing' ? 'Turning your words into text…' : noneLeft ? 'No questions left today' : 'ചോദിക്കൂ… / Ask anything'}
                autoSize={{ minRows: 1, maxRows: 4 }}
                maxLength={2000}
                disabled={busy || noneLeft}
                variant="borderless"
                enterKeyHint="send"
              />
              {showVoice && (
                <Tooltip title="Speak your question">
                  <Button
                    type="text"
                    shape="circle"
                    icon={<AudioOutlined />}
                    loading={voice.status === 'transcribing'}
                    onClick={voice.start}
                    disabled={busy || noneLeft}
                    aria-label="Speak your question"
                  />
                </Tooltip>
              )}
              <Button
                type="primary"
                shape="circle"
                icon={<SendOutlined />}
                onClick={() => ask(draft)}
                disabled={!draft.trim() || busy || noneLeft}
                aria-label="Send"
              />
            </>
          )}
        </div>
        <div className="assistant-meta">
          {showVoice && (
            <>
              <label className="assistant-auto-send">
                <Switch
                  size="small"
                  checked={autoSend}
                  onChange={(on) => {
                    setAutoSend(on);
                    try {
                      window.localStorage.setItem(AUTO_SEND_KEY, on ? 'on' : 'off');
                    } catch {
                      // not kept
                    }
                  }}
                  aria-label="Send spoken questions automatically"
                />
                <span>Auto-send</span>
              </label>
              <span>Voice</span>
              <Select
                size="small"
                value={voiceLanguage}
                onChange={setLanguage}
                options={VOICE_LANGUAGES}
                popupMatchSelectWidth={false}
                variant="borderless"
                aria-label="Voice language"
              />
            </>
          )}
          {!showVoice && <span className="assistant-disclaimer">Answers come from the masjid records - check important figures.</span>}
        </div>
      </div>
    </div>
    </ConfigProvider>
  );
}
