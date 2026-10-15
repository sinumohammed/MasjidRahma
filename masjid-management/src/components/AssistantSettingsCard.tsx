import { useEffect, useState } from 'react';
import { Card, InputNumber, Button, message, Space, Spin } from 'antd';
import { RobotOutlined, SaveOutlined } from '@ant-design/icons';
import { getAssistantSettings, saveAssistantSettings, type AssistantDailyLimits } from '../services/api';

// Settings page, admin only: how many Assistant questions each user may ask
// a day. Every question spends the AI service's shared free quota. Saved on
// the server and used at once - no redeploy. 0 means no limit.
const ROWS: { role: keyof AssistantDailyLimits; label: string; hint: string }[] = [
  { role: 'member', label: 'Each member', hint: 'per logged-in member, per day' },
  { role: 'guest', label: 'Visitors (not logged in)', hint: 'per internet connection (IP address), per day' },
  { role: 'admin', label: 'Admin', hint: 'for your own account; 0 = no limit' },
];

export default function AssistantSettingsCard() {
  const [limits, setLimits] = useState<AssistantDailyLimits | null>(null);
  const [saved, setSaved] = useState<AssistantDailyLimits | null>(null);
  const [max, setMax] = useState(100);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getAssistantSettings()
      .then((s) => {
        setLimits(s.dailyLimits);
        setSaved(s.dailyLimits);
        setMax(s.max);
      })
      .catch((err) => message.error(err instanceof Error ? err.message : 'Failed to load the assistant settings'));
  }, []);

  const changed = Boolean(limits && saved && ROWS.some(({ role }) => limits[role] !== saved[role]));

  const save = async () => {
    if (!limits) return;
    setSaving(true);
    try {
      const { dailyLimits } = await saveAssistantSettings(limits);
      setLimits(dailyLimits);
      setSaved(dailyLimits);
      message.success('Assistant limits saved - they apply from the next question');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title={<span><RobotOutlined /> Assistant</span>} className="settings-card" variant="borderless">
      <p className="settings-row-hint">Questions each person may ask the Assistant per day. 0 means no limit.</p>
      {!limits ? (
        <Spin />
      ) : (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {ROWS.map(({ role, label, hint }) => (
            <div key={role} className="assistant-limit-row">
              <div className="assistant-limit-label">
                <div>{label}</div>
                <div className="settings-row-hint">{hint}</div>
              </div>
              <InputNumber
                min={0}
                max={max}
                precision={0}
                value={limits[role]}
                onChange={(v) => setLimits({ ...limits, [role]: typeof v === 'number' ? v : 0 })}
                aria-label={`${label}: questions per day`}
                style={{ width: 90 }}
              />
            </div>
          ))}
          <Button type="primary" icon={<SaveOutlined />} onClick={save} loading={saving} disabled={!changed}>
            Save
          </Button>
        </Space>
      )}
    </Card>
  );
}
