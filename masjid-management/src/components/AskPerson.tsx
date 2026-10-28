import { useEffect, useState } from 'react';
import { Modal, Input, Button, Tag, Empty, message } from 'antd';
import { ArrowLeftOutlined, SendOutlined, UserOutlined } from '@ant-design/icons';
import { askPerson, getHandovers, markHandoverSeen, writeToPerson, type HandoverTicket } from '../services/api';

// "Ask a person": when the assistant cannot help, a logged-in user sends the
// question - with this chat - to a person (server/handover.js), who replies in
// the app (and on Telegram, if linked). Labels in English and Malayalam, like
// the rest of the assistant.

const STATUS: Record<HandoverTicket['status'], { color: string; label: string }> = {
  open: { color: 'gold', label: 'Waiting · കാത്തിരിക്കുന്നു' },
  answered: { color: 'green', label: 'Answered · മറുപടി ലഭിച്ചു' },
  closed: { color: 'default', label: 'Closed · അവസാനിച്ചു' },
};

const when = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// The confirm step: what is sent, to whom, and an optional note.
// `question`: the one the assistant could not answer; none = the user writes it.
export function AskPersonModal({
  open,
  onClose,
  chatId,
  person,
  question,
  reason,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  chatId: string;
  person: string;
  question?: string;
  reason?: string;
  onSent: (ticket: HandoverTicket) => void;
}) {
  const [note, setNote] = useState('');
  const [own, setOwn] = useState('');
  const [sending, setSending] = useState(false);
  useEffect(() => {
    if (open) {
      setNote('');
      setOwn('');
    }
  }, [open]);

  const send = async () => {
    if (!question && !own.trim()) return;
    setSending(true);
    try {
      const ticket = await askPerson(chatId, question ? { question, note: note.trim() || undefined, reason } : { question: own.trim() });
      message.success(`Sent to ${person} · അയച്ചു`);
      onSent(ticket);
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Could not send it - please try again');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={`Ask ${person} · ഒരാളോട് ചോദിക്കൂ`}
      okText="Send · അയക്കൂ"
      cancelText="Cancel"
      onOk={send}
      confirmLoading={sending}
      okButtonProps={{ disabled: !question && !own.trim() }}
      destroyOnHidden
    >
      <p className="askperson-intro">
        {question
          ? `Your question and this chat go to ${person}, who will reply here in the Assistant.`
          : `Write your question - ${person} will reply here in the Assistant.`}
        <br />
        <span className="askperson-ml">{person} ഇത് വായിച്ച് ഇവിടെ മറുപടി നൽകും.</span>
      </p>
      {question ? (
        <>
          <blockquote className="askperson-question">{question}</blockquote>
          <Input.TextArea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} autoSize={{ minRows: 2, maxRows: 5 }} placeholder="Anything to add? (optional) · കൂടുതൽ എന്തെങ്കിലും?" aria-label="A note for the person" />
        </>
      ) : (
        <Input.TextArea value={own} onChange={(e) => setOwn(e.target.value)} maxLength={2000} autoSize={{ minRows: 3, maxRows: 6 }} placeholder="Your question · നിങ്ങളുടെ ചോദ്യം" aria-label="Your question" autoFocus />
      )}
    </Modal>
  );
}

// Everything sent to the person, newest first; one opens to its thread, where the user can write back.
// onWrote: the user wrote back - the chat checks for the reply more often again.
export function PersonPanel({ person, onBack, onAskNew, onSeen, onWrote, refreshKey }: { person: string; onBack: () => void; onAskNew: () => void; onSeen: () => void; onWrote: () => void; refreshKey: number }) {
  const [tickets, setTickets] = useState<HandoverTicket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getHandovers()
      .then((r) => !cancelled && (setTickets(r.tickets), setError(null)))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Could not load them'));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const open = tickets?.find((t) => t.id === openId) ?? null;
  // Opening a thread marks its replies read.
  useEffect(() => {
    if (open && open.newReplies > 0) {
      markHandoverSeen(open.id)
        .then(() => {
          setTickets((ts) => ts && ts.map((t) => (t.id === open.id ? { ...t, newReplies: 0 } : t)));
          onSeen();
        })
        .catch(() => {});
    }
  }, [open, onSeen]);

  const send = async () => {
    if (!open || !draft.trim()) return;
    setSending(true);
    try {
      const updated = await writeToPerson(open.id, draft.trim());
      setTickets((ts) => ts && ts.map((t) => (t.id === updated.id ? updated : t)));
      setDraft('');
      onWrote();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Could not send it - please try again');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="askperson-panel">
      <div className="askperson-panel-head">
        <Button type="text" shape="circle" icon={<ArrowLeftOutlined />} onClick={open ? () => setOpenId(null) : onBack} aria-label="Back" />
        <div className="askperson-panel-title">{open ? open.question : `Your questions to ${person}`}</div>
      </div>
      <div className="askperson-panel-body">
        {error ? (
          <p className="askperson-muted">{error}</p>
        ) : !tickets ? (
          <p className="askperson-muted">Loading…</p>
        ) : open ? (
          <div className="askperson-thread">
            <Tag color={STATUS[open.status].color}>{STATUS[open.status].label}</Tag>
            {open.messages.map((m) => (
              <div key={m.id} className={`askperson-msg ${m.from === 'owner' ? 'is-person' : 'is-me'}`}>
                <span className="askperson-who">
                  {m.from === 'owner' ? person : 'You · നിങ്ങൾ'} · {when.format(new Date(m.at))}
                </span>
                <div>{m.text}</div>
              </div>
            ))}
          </div>
        ) : tickets.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`Nothing sent yet. When the assistant cannot help, tap “Ask a person” under its answer.`} />
        ) : (
          <ul className="askperson-list">
            {tickets.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => setOpenId(t.id)}>
                  <span className="askperson-list-q">{t.question}</span>
                  <span className="askperson-list-meta">
                    <Tag color={STATUS[t.status].color}>{STATUS[t.status].label}</Tag>
                    {t.newReplies > 0 && <Tag color="red">New reply · പുതിയ മറുപടി</Tag>}
                    <span>{when.format(new Date(t.updatedAt))}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="askperson-panel-foot">
        {open ? (
          <div className="askperson-compose">
            <Input.TextArea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={2000}
              autoSize={{ minRows: 1, maxRows: 4 }}
              placeholder={`Write to ${person}… · മറുപടി എഴുതൂ`}
              onPressEnter={(e) => {
                if (!e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              aria-label={`Write to ${person}`}
            />
            <Button type="primary" shape="circle" icon={<SendOutlined />} loading={sending} disabled={!draft.trim()} onClick={send} aria-label="Send" />
          </div>
        ) : (
          <Button block icon={<UserOutlined />} onClick={onAskNew}>
            Ask {person} a new question · പുതിയ ചോദ്യം
          </Button>
        )}
      </div>
    </div>
  );
}
