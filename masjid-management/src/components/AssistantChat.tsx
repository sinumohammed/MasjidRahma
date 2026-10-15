import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Card, Input, Button, Alert, Tag, Typography, Popconfirm, Spin, Select, Tooltip, message } from 'antd';
import { RobotOutlined, SendOutlined, ClearOutlined, AudioOutlined, CheckOutlined, CloseOutlined, HistoryOutlined } from '@ant-design/icons';
import {
  askAssistant,
  clearAssistantChat,
  getAssistantStatus,
  AssistantError,
  type AssistantSource,
  type AssistantQuota,
} from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useVoiceRecorder, voiceSupported } from './useVoiceRecorder';
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
}

const MAX_KEPT = 40;
const MAX_RECENT = 6;
const VOICE_LANGUAGE_KEY = 'masjid_assistant_voice_language';
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
function loadVoiceLanguage(): string {
  try {
    return window.localStorage.getItem(VOICE_LANGUAGE_KEY) || 'auto';
  } catch {
    return 'auto';
  }
}

// "**bold**" -> <strong>; lines starting with "- " or "1. " keep their own line.
function formatAnswer(text: string): ReactNode[] {
  return text.split('\n').map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
      part.startsWith('**') && part.endsWith('**') ? <strong key={j}>{part.slice(2, -2)}</strong> : part
    );
    return (
      <div key={i} className={/^\s*([-*]|\d+\.)\s/.test(line) ? 'assistant-line assistant-list-line' : 'assistant-line'}>
        {parts.length && line.trim() ? parts : ' '}
      </div>
    );
  });
}

// "masjid API: GET /ai/duty-on-date?date=..." means nothing to a member: the
// app's own data is shown as its records; anything else by its section.
function sourceLabel(s: AssistantSource): string {
  return s.source === 'masjid API' ? 'Masjid records' : s.section ?? s.source;
}

// `embedded`: inside the floating chat's drawer (it has its own title).
export default function AssistantChat({ embedded = false }: { embedded?: boolean }) {
  const { isAdmin, isLoggedIn, username } = useAuth();
  const account = isLoggedIn ? username : null;
  const [chatId, setChatId] = useState(() => chatIdFor(isLoggedIn));
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadMessages(account));
  const [draft, setDraft] = useState('');
  const [asking, setAsking] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [recent, setRecent] = useState<string[]>(() => loadRecent(account));
  const [quota, setQuota] = useState<AssistantQuota | null>(null);
  const [voiceLanguage, setVoiceLanguage] = useState(loadVoiceLanguage);
  const endRef = useRef<HTMLDivElement>(null);
  const noneLeft = quota?.remaining === 0;

  const voice = useVoiceRecorder({
    language: voiceLanguage,
    onText: (text) => setDraft((d) => (d.trim() ? `${d.trim()} ${text}` : text)),
    onError: (msg) => message.warning(msg),
  });

  // Logging in or out switches to that account's chat, recent questions and count.
  useEffect(() => {
    setChatId(chatIdFor(isLoggedIn));
    setMessages(loadMessages(account));
    setRecent(loadRecent(account));
    let cancelled = false;
    getAssistantStatus()
      .then((s) => !cancelled && setQuota(s.limit !== undefined ? { limit: s.limit ?? null, remaining: s.remaining ?? null } : null))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, account]);

  useEffect(() => {
    saveMessages(account, messages);
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, account]);

  const suggestions = !isLoggedIn
    ? ['Who supplies food today?', 'Who is on food duty tomorrow?', 'Who is on duty this Friday?', 'Which days is MR#001 on duty this month?']
    : isAdmin
      ? ['Who supplies food today?', 'Which members have pending dues?', 'How much did we spend this month?', 'What are the bank balances?']
      : ['Who supplies food today?', 'When is my next food duty?', 'Do I have any pending dues?', 'What is the latest announcement?'];

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || asking || noneLeft) return;
    setDraft('');
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setRecent((r) => rememberQuestion(account, r, q));
    setAsking(true);
    try {
      const { answer, sources, limit, remaining } = await askAssistant(q, chatId);
      setMessages((m) => [...m, { role: 'assistant', text: answer, sources }]);
      setQuota({ limit, remaining });
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', text: err instanceof Error ? err.message : 'The assistant could not answer', error: true }]);
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
      <Button shape="circle" icon={<ClearOutlined />} loading={clearing} aria-label="Clear chat" />
    </Popconfirm>
  );

  // "7 of 10 questions left today" - nothing when there is no limit (admin).
  const quotaTag = quota?.limit ? (
    <Tag className="assistant-quota" color={noneLeft ? 'error' : quota.remaining! <= 2 ? 'warning' : 'default'}>
      {noneLeft ? 'No questions left today' : `${quota.remaining} of ${quota.limit} questions left today`}
    </Tag>
  ) : null;
  const headerActions = (quotaTag || clearButton) && (
    <span className="assistant-header-actions">
      {quotaTag}
      {clearButton}
    </span>
  );

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
    <Card
      className={`assistant-card${embedded ? ' assistant-embedded' : ''}`}
      variant={embedded ? 'borderless' : undefined}
      title={
        embedded ? undefined : (
          <span className="assistant-title">
            <RobotOutlined /> Assistant
          </span>
        )
      }
      extra={embedded ? undefined : headerActions}
    >
      {embedded && headerActions && <div className="assistant-embedded-actions">{headerActions}</div>}
      <div className="assistant-messages">
        {messages.length === 0 && (
          <div className="assistant-empty">
            <Typography.Paragraph type="secondary">
              {!isLoggedIn
                ? 'Ask who is on food duty today, tomorrow or any day this year. Log in to ask about dues and more.'
                : `Ask about the food-duty schedule, members, dues${isAdmin ? ', income and expenses' : ''} or announcements.${isAdmin ? '' : ' You see your own dues and payments only.'}`}
            </Typography.Paragraph>
            {recent.length > 0 && (
              <Typography.Text type="secondary" className="assistant-chip-label">
                <HistoryOutlined /> Your recent questions
              </Typography.Text>
            )}
            {recent.length > 0 && (
              <div className="assistant-suggestions">
                {recent.map((s) => (
                  <Tag key={s} className="assistant-suggestion assistant-recent" onClick={() => ask(s)}>
                    {s}
                  </Tag>
                ))}
              </div>
            )}
            <div className="assistant-suggestions">
              {suggestions.filter((s) => !recent.includes(s)).map((s) => (
                <Tag key={s} className="assistant-suggestion" onClick={() => ask(s)}>
                  {s}
                </Tag>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`assistant-bubble assistant-${m.role}`}>
            {m.role === 'assistant' && !m.error ? formatAnswer(m.text) : m.error ? <Alert type="warning" showIcon message={m.text} /> : m.text}
            {m.sources && m.sources.length > 0 && (
              <div className="assistant-sources">
                {m.sources.map((s) => (
                  <Tag key={`${s.n}-${s.source}`} className="assistant-source">
                    [{s.n}] {sourceLabel(s)}
                  </Tag>
                ))}
              </div>
            )}
          </div>
        ))}
        {asking && (
          <div className="assistant-bubble assistant-assistant assistant-thinking">
            <Spin size="small" /> <span>Looking it up…</span>
          </div>
        )}
        <div ref={endRef} />
      </div>
      {/* Recent questions while chatting, one tap to ask again. */}
      {messages.length > 0 && recent.length > 0 && voice.status === 'idle' && (
        <div className="assistant-recent-row" aria-label="Your recent questions">
          <HistoryOutlined className="assistant-recent-icon" />
          {recent.map((s) => (
            <Tag key={s} className="assistant-suggestion assistant-recent" onClick={() => ask(s)}>
              {s}
            </Tag>
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
      {voice.status === 'recording' ? (
        <div className="assistant-input-row assistant-recording">
          <span className="assistant-rec-dot" aria-hidden />
          <span className="assistant-rec-time">
            Listening… {Math.floor(voice.seconds / 60)}:{String(voice.seconds % 60).padStart(2, '0')}
          </span>
          <Button shape="circle" icon={<CloseOutlined />} onClick={voice.cancel} aria-label="Cancel recording" />
          <Button type="primary" shape="circle" icon={<CheckOutlined />} onClick={voice.stop} aria-label="Done speaking" />
        </div>
      ) : (
        <div className="assistant-input-row">
          <Input.TextArea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault();
                ask(draft);
              }
            }}
            placeholder={voice.status === 'transcribing' ? 'Turning your words into text…' : 'Ask a question…'}
            autoSize={{ minRows: 1, maxRows: 4 }}
            maxLength={2000}
            disabled={busy || noneLeft}
          />
          {showVoice && (
            <Tooltip title="Speak your question">
              <Button
                shape="circle"
                icon={<AudioOutlined />}
                loading={voice.status === 'transcribing'}
                onClick={voice.start}
                disabled={busy || noneLeft}
                aria-label="Speak your question"
              />
            </Tooltip>
          )}
          <Button type="primary" shape="circle" icon={<SendOutlined />} onClick={() => ask(draft)} disabled={!draft.trim() || busy || noneLeft} aria-label="Send" />
        </div>
      )}
      {showVoice && (
        <div className="assistant-voice-language">
          <Typography.Text type="secondary">Voice:</Typography.Text>
          <Select size="small" value={voiceLanguage} onChange={setLanguage} options={VOICE_LANGUAGES} popupMatchSelectWidth={false} variant="borderless" aria-label="Voice language" />
        </div>
      )}
    </Card>
  );
}
