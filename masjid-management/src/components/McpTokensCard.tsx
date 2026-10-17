import { useEffect, useState } from 'react';
import { Card, Button, Input, Modal, Popconfirm, Typography, Alert, Space, Spin, message } from 'antd';
import { ApiOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { getMcpTokens, createMcpToken, revokeMcpToken, MCP_URL, type McpToken } from '../services/api';

// Settings page, admin only: personal tokens that let an MCP client such as
// Claude Code read the masjid data (/api/ai/mcp) as this admin. A token is
// shown once; the server keeps only its hash. Revoke stops it at once.
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'never');

export default function McpTokensCard() {
  const [tokens, setTokens] = useState<McpToken[] | null>(null);
  const [name, setName] = useState('Claude Code');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);

  const load = () =>
    getMcpTokens()
      .then(setTokens)
      .catch((err) => message.error(err instanceof Error ? err.message : 'Failed to load the MCP tokens'));

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    setCreating(true);
    try {
      const t = await createMcpToken(name.trim());
      setCreated({ name: t.name, token: t.token });
      load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to create the token');
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      await revokeMcpToken(id);
      message.success('Token revoked - refused from the next request');
      load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to revoke');
    }
  };

  const command = created ? `claude mcp add --transport http masjid ${MCP_URL} --header "Authorization: Bearer ${created.token}"` : '';

  return (
    <Card title={<span><ApiOutlined /> Claude access (MCP)</span>} className="settings-card" variant="borderless">
      <p className="settings-row-hint">
        A personal token lets Claude Code read the masjid records with your admin rights - members, dues, accounts. What it reads
        is sent to Anthropic. Make one token per computer; revoke it when it is no longer used.
      </p>
      {!tokens ? (
        <Spin />
      ) : (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {tokens.length === 0 && <p className="settings-row-hint">No tokens yet.</p>}
          {tokens.map((t) => (
            <div key={t.id} className="assistant-limit-row">
              <div className="assistant-limit-label">
                <div>
                  {t.name} <Typography.Text type="secondary">…{t.hint}</Typography.Text>
                </div>
                <div className="settings-row-hint">
                  made {when(t.createdAt)} by {t.username} · last used {when(t.lastUsedAt)}
                </div>
              </div>
              <Popconfirm title="Revoke this token?" description="Claude Code using it stops working at once." onConfirm={() => revoke(t.id)} okText="Revoke" cancelText="Cancel">
                <Button danger icon={<DeleteOutlined />} aria-label={`Revoke ${t.name}`} />
              </Popconfirm>
            </div>
          ))}
          <Space.Compact style={{ width: '100%' }}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Claude Code on my laptop" aria-label="Token name" />
            <Button type="primary" icon={<PlusOutlined />} onClick={create} loading={creating} disabled={!name.trim()}>
              Create
            </Button>
          </Space.Compact>
        </Space>
      )}
      <Modal open={Boolean(created)} title={`Token "${created?.name}" created`} onCancel={() => setCreated(null)} footer={<Button type="primary" onClick={() => setCreated(null)}>Done</Button>}>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Alert type="warning" showIcon message="Copy it now - it is shown only this once." />
          <div>
            <div className="settings-row-hint">Run this in a terminal on the computer with Claude Code:</div>
            <Typography.Paragraph code copyable={{ text: command }} style={{ wordBreak: 'break-all', marginBottom: 0 }}>
              {command}
            </Typography.Paragraph>
          </div>
          <div>
            <div className="settings-row-hint">The token alone, for other MCP clients:</div>
            <Typography.Paragraph code copyable style={{ wordBreak: 'break-all', marginBottom: 0 }}>
              {created?.token}
            </Typography.Paragraph>
          </div>
        </Space>
      </Modal>
    </Card>
  );
}
