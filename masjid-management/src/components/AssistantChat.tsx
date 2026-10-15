import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Card, Input, Button, Alert, Tag, Typography, Popconfirm, Spin } from 'antd';
import { RobotOutlined, SendOutlined, ClearOutlined } from '@ant-design/icons';
import { askAssistant, clearAssistantChat, type AssistantSource } from '../services/api';
import { useAuth } from '../context/AuthContext';
import './AssistantChat.css';

// Ask questions about the masjid's data in plain words. The server asks the
// AI service for the logged-in user (server: /api/assistant/ask), and the AI
// answers from this app's data as that user may see it: the admin sees
// everything, a member the schedule, announcements and their own dues and
// payments; a visitor who is not logged in, only the food-duty schedule.
// The conversation is remembered on the AI side (24 hours); this screen keeps
// its own copy per account in localStorage, to show it again.

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  sources?: AssistantSource[];
  error?: boolean;
}

const MAX_KEPT = 40;
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

// `embedded`: inside the floating chat's drawer (it has its own title).
// "masjid API: GET /ai/duty-on-date?date=..." means nothing to a member: the
// app's own data is shown as its records; anything else by its section.
function sourceLabel(s: AssistantSource): string {
  return s.source === 'masjid API' ? 'Masjid records' : s.section ?? s.source;
}

export default function AssistantChat({ embedded = false }: { embedded?: boolean }) {
  const { isAdmin, isLoggedIn, username } = useAuth();
  const account = isLoggedIn ? username : null;
  const [chatId, setChatId] = useState(() => chatIdFor(isLoggedIn));
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadMessages(account));
  const [draft, setDraft] = useState('');
  const [asking, setAsking] = useState(false);
  const [clearing, setClearing] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Logging in or out switches to that account's chat.
  useEffect(() => {
    setChatId(chatIdFor(isLoggedIn));
    setMessages(loadMessages(account));
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
    if (!q || asking) return;
    setDraft('');
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setAsking(true);
    try {
      const { answer, sources } = await askAssistant(q, chatId);
      setMessages((m) => [...m, { role: 'assistant', text: answer, sources }]);
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', text: err instanceof Error ? err.message : 'The assistant could not answer', error: true }]);
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
      extra={embedded ? undefined : clearButton}
    >
      {embedded && clearButton && <div className="assistant-embedded-actions">{clearButton}</div>}
      <div className="assistant-messages">
        {messages.length === 0 && (
          <div className="assistant-empty">
            <Typography.Paragraph type="secondary">
              {!isLoggedIn
                ? 'Ask who is on food duty today, tomorrow or any day this year. Log in to ask about dues and more.'
                : `Ask about the food-duty schedule, members, dues${isAdmin ? ', income and expenses' : ''} or announcements.${isAdmin ? '' : ' You see your own dues and payments only.'}`}
            </Typography.Paragraph>
            <div className="assistant-suggestions">
              {suggestions.map((s) => (
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
          placeholder="Ask a question…"
          autoSize={{ minRows: 1, maxRows: 4 }}
          maxLength={2000}
          disabled={asking}
        />
        <Button type="primary" shape="circle" icon={<SendOutlined />} onClick={() => ask(draft)} disabled={!draft.trim() || asking} aria-label="Send" />
      </div>
    </Card>
  );
}
