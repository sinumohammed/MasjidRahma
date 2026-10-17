import { useEffect, useState } from 'react';
import { Card, Button, Popconfirm, Alert, Space, Spin, Typography, message } from 'antd';
import { SendOutlined, DisconnectOutlined, LinkOutlined } from '@ant-design/icons';
import {
  getTelegramLink,
  createTelegramLinkCode,
  unlinkTelegram,
  getTelegramBotStatus,
  connectTelegramBot,
  type TelegramLinkStatus,
  type TelegramBotStatus,
} from '../services/api';

// The assistant on Telegram (server/telegram.js). Everyone logged in: link
// their Telegram account, so the bot answers as them. The admin (Settings)
// also sees the bot's status and points Telegram at this server.
// Hidden when the bot is not set up on the server (no TELEGRAM_BOT_TOKEN),
// except for the admin, who is told what is missing.
const when = (iso: string) => new Date(iso).toLocaleString();

export default function TelegramCard({ admin = false, className = 'settings-card' }: { admin?: boolean; className?: string }) {
  const [link, setLink] = useState<TelegramLinkStatus | null>(null);
  const [bot, setBot] = useState<TelegramBotStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);

  const load = () => {
    getTelegramLink()
      .then(setLink)
      .catch(() => setLink({ available: false }));
    if (admin) {
      getTelegramBotStatus()
        .then(setBot)
        .catch((err) => message.error(err instanceof Error ? err.message : 'Failed to load the Telegram bot status'));
    }
  };

  useEffect(() => {
    load();
  }, [admin]);

  // The link is shown as a real link to tap: phones block a window opened
  // after a request. Opening it, Telegram sends the bot /start <code>.
  const connectMe = async () => {
    setBusy(true);
    try {
      setLinkUrl((await createTelegramLinkCode()).url);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to make a Telegram link');
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    try {
      await unlinkTelegram();
      message.success('Telegram unlinked - the bot treats it as a guest now');
      load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to unlink');
    }
  };

  const connectBot = async () => {
    setBusy(true);
    try {
      const r = await connectTelegramBot();
      message.success(`@${r.botUsername} now sends its messages here`);
      load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to connect the bot');
    } finally {
      setBusy(false);
    }
  };

  if (!link || (admin && !bot)) {
    return admin ? (
      <Card title={<span><SendOutlined /> Telegram</span>} className={className} variant="borderless">
        <Spin />
      </Card>
    ) : null;
  }
  if (!admin && !link.available) return null;

  const expectedWebhook = `${window.location.origin}/api/telegram/webhook`;
  const botLink = link.botUsername ?? bot?.botUsername;

  return (
    <Card title={<span><SendOutlined /> Telegram</span>} className={className} variant="borderless">
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {admin && bot && !bot.configured && (
          <Alert
            type="info"
            showIcon
            message="The bot is not set up yet"
            description="Make a bot with @BotFather in Telegram, put its token in the server's TELEGRAM_BOT_TOKEN, redeploy, then come back here and press Connect the bot."
          />
        )}
        {admin && bot?.configured && (
          <>
            <p className="settings-row-hint">
              The assistant as a Telegram bot{botLink ? <> - <a href={`https://t.me/${botLink}`} target="_blank" rel="noreferrer">@{botLink}</a></> : null}. Members link by
              sharing their phone number with the bot (the number on their member record); anyone else asks as a guest - only the food-duty schedule.
              Same daily limits as the app. {bot.linkedAccounts ?? 0} Telegram account{bot.linkedAccounts === 1 ? '' : 's'} linked.
            </p>
            {!bot.assistant && <Alert type="warning" showIcon message="The assistant is not set up on this server, so the bot cannot answer" />}
            {bot.webhookUrl === expectedWebhook ? (
              <Typography.Text type="success">Connected - Telegram sends messages to this server.</Typography.Text>
            ) : (
              <Alert
                type="warning"
                showIcon
                message={bot.webhookUrl ? `Telegram sends messages to ${bot.webhookUrl}` : 'Telegram does not send the messages here yet'}
                action={<Button size="small" type="primary" onClick={connectBot} loading={busy}>Connect the bot</Button>}
              />
            )}
            {bot.lastError && (
              <Typography.Text type="secondary">
                Last delivery error ({when(bot.lastError.at)}): {bot.lastError.message}
              </Typography.Text>
            )}
          </>
        )}
        {link.available && (
          <>
            {!admin && (
              <p className="settings-row-hint">
                Ask the masjid assistant on Telegram{botLink ? <> - <a href={`https://t.me/${botLink}`} target="_blank" rel="noreferrer">@{botLink}</a></> : null}. Link your
                Telegram so it answers about your own dues and payments. (Or open the bot and share your phone number.)
              </p>
            )}
            {(link.links ?? []).map((l) => (
              <div key={l.createdAt} className="assistant-limit-row">
                <div className="assistant-limit-label">
                  <div>{l.displayName ?? 'Telegram account'}</div>
                  <div className="settings-row-hint">linked {when(l.createdAt)}</div>
                </div>
                <Popconfirm title="Unlink this Telegram account?" description="The bot will answer it as a guest." onConfirm={unlink} okText="Unlink" cancelText="Cancel">
                  <Button danger icon={<DisconnectOutlined />} aria-label="Unlink Telegram" />
                </Popconfirm>
              </div>
            ))}
            {linkUrl ? (
              <Space wrap>
                <Button type="primary" icon={<SendOutlined />} href={linkUrl} target="_blank" rel="noreferrer">
                  Open Telegram
                </Button>
                <span className="settings-row-hint">then press Start - the link works once, for 10 minutes.</span>
                <Button type="link" onClick={() => { setLinkUrl(null); load(); }}>Done</Button>
              </Space>
            ) : (
              <Button icon={<LinkOutlined />} onClick={connectMe} loading={busy}>
                {(link.links ?? []).length ? 'Link another Telegram account' : 'Link my Telegram'}
              </Button>
            )}
          </>
        )}
      </Space>
    </Card>
  );
}
