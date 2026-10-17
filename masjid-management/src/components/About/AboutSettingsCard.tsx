import { useEffect, useRef, useState } from 'react';
import { Card, Input, Button, Modal, Segmented, AutoComplete, Popconfirm, Space, Spin, message } from 'antd';
import { BookOutlined, PlusOutlined, EditOutlined, DeleteOutlined, ArrowUpOutlined, ArrowDownOutlined, CameraOutlined } from '@ant-design/icons';
import {
  getAbout,
  saveAboutText,
  addPerson,
  updatePerson,
  deletePerson,
  reorderPeople,
  type AboutText,
  type MasjidPerson,
  type PersonGroup,
} from '../../services/api';
import { PersonPhoto } from './AboutMasjid';
import { resizePhoto } from './resizePhoto';

// Settings page, admin only: About the masjid - the story shown to everyone,
// and the people behind it with their photos. Saved at once, no redeploy.
const ROLE_OPTIONS = ['President', 'Vice President', 'Secretary', 'Treasurer', 'Imam', 'Khatib', 'Muaddin', 'Committee member', 'Founder'].map((value) => ({ value }));
const GROUP_LABEL: Record<PersonGroup, string> = { leadership: 'Serving today', founders: 'Founder' };
const EMPTY_TEXT: AboutText = { story: '', founded: '', address: '', tagline: '' };

interface Draft {
  id?: string;
  name: string;
  role: string;
  since: string;
  group: PersonGroup;
  photo?: string | null; // data URL = new, null = remove, undefined = keep
  photoUrl: string | null; // what is shown now
}

export default function AboutSettingsCard() {
  const [text, setText] = useState<AboutText | null>(null);
  const [savedText, setSavedText] = useState<AboutText>(EMPTY_TEXT);
  const [people, setPeople] = useState<MasjidPerson[]>([]);
  const [savingText, setSavingText] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [savingPerson, setSavingPerson] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getAbout()
      .then(({ people, ...t }) => {
        setText(t);
        setSavedText(t);
        setPeople(people);
      })
      .catch((err) => message.error(err instanceof Error ? err.message : 'Failed to load About the masjid'));
  }, []);

  const textChanged = Boolean(text && (Object.keys(EMPTY_TEXT) as (keyof AboutText)[]).some((k) => text[k] !== savedText[k]));

  const saveText = async () => {
    if (!text) return;
    setSavingText(true);
    try {
      const t = await saveAboutText(text);
      setText(t);
      setSavedText(t);
      message.success('Saved - everyone sees it now');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSavingText(false);
    }
  };

  const pickPhoto = async (file: File | undefined) => {
    if (!file || !draft) return;
    try {
      const photo = await resizePhoto(file);
      setDraft({ ...draft, photo, photoUrl: photo });
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Could not read that photo');
    }
  };

  const savePerson = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      message.error('Please enter a name');
      return;
    }
    setSavingPerson(true);
    try {
      const body = { name: draft.name, role: draft.role, since: draft.since, group: draft.group, ...(draft.photo !== undefined ? { photo: draft.photo } : {}) };
      const { people } = draft.id ? await updatePerson(draft.id, body) : await addPerson(body);
      setPeople(people);
      setDraft(null);
      message.success('Saved');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSavingPerson(false);
    }
  };

  const remove = async (id: string) => {
    try {
      setPeople((await deletePerson(id)).people);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to remove');
    }
  };

  // Up or down within the whole list (the page shows each group in this order).
  const move = async (index: number, by: -1 | 1) => {
    const ids = people.map((p) => p.id);
    const j = index + by;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    try {
      setPeople((await reorderPeople(ids)).people);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to save the order');
    }
  };

  const field = (k: keyof AboutText) => ({
    value: text?.[k] ?? '',
    onChange: (e: { target: { value: string } }) => text && setText({ ...text, [k]: e.target.value }),
  });

  return (
    <Card title={<span><BookOutlined /> About the masjid</span>} className="settings-card" variant="borderless">
      <p className="settings-row-hint">Shown to everyone: on the home page before login, and as "About" in the menu.</p>
      {!text ? (
        <Spin />
      ) : (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <Input {...field('tagline')} maxLength={160} placeholder="One line, e.g. A home for prayer, learning and caring for one another" aria-label="Tagline" />
            <Space.Compact style={{ width: '100%' }}>
              <Input {...field('founded')} maxLength={30} placeholder="Founded, e.g. 2004" aria-label="Founded" style={{ maxWidth: 180 }} />
              <Input {...field('address')} maxLength={200} placeholder="Address or place" aria-label="Address" />
            </Space.Compact>
            <Input.TextArea {...field('story')} maxLength={4000} autoSize={{ minRows: 4, maxRows: 14 }} placeholder="The masjid's story - how it started, who it serves. A blank line starts a new paragraph." aria-label="Story" />
            <Button type="primary" onClick={saveText} loading={savingText} disabled={!textChanged}>
              Save text
            </Button>
          </Space>

          <div>
            <div className="about-admin-head">
              <strong>People</strong>
              <Button icon={<PlusOutlined />} onClick={() => setDraft({ name: '', role: '', since: '', group: 'leadership', photoUrl: null })}>
                Add a person
              </Button>
            </div>
            {people.length === 0 && <p className="settings-row-hint">No one yet - add the president, imam, muaddin and the founders.</p>}
            <div className="about-admin-list">
              {people.map((p, i) => (
                <div key={p.id} className="about-admin-row">
                  <PersonPhoto person={p} size={44} />
                  <div className="about-admin-row-text">
                    <div>{p.name}</div>
                    <div className="settings-row-hint">
                      {[p.role, p.role === GROUP_LABEL[p.group] ? '' : GROUP_LABEL[p.group], p.since].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <div className="about-admin-row-actions">
                    <Button size="small" type="text" icon={<ArrowUpOutlined />} onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${p.name} up`} />
                    <Button size="small" type="text" icon={<ArrowDownOutlined />} onClick={() => move(i, 1)} disabled={i === people.length - 1} aria-label={`Move ${p.name} down`} />
                    <Button size="small" type="text" icon={<EditOutlined />} onClick={() => setDraft({ id: p.id, name: p.name, role: p.role, since: p.since, group: p.group, photoUrl: p.photoUrl })} aria-label={`Edit ${p.name}`} />
                    <Popconfirm title={`Remove ${p.name}?`} onConfirm={() => remove(p.id)} okText="Remove" cancelText="Cancel">
                      <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label={`Remove ${p.name}`} />
                    </Popconfirm>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Space>
      )}

      <Modal
        open={Boolean(draft)}
        title={draft?.id ? 'Edit person' : 'Add a person'}
        onCancel={() => setDraft(null)}
        onOk={savePerson}
        okText="Save"
        confirmLoading={savingPerson}
        destroyOnHidden
      >
        {draft && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <div className="about-admin-photo">
              <PersonPhoto person={{ name: draft.name || '?', photoUrl: draft.photoUrl }} size={96} />
              <Space direction="vertical" size="small">
                <Button icon={<CameraOutlined />} onClick={() => fileRef.current?.click()}>
                  {draft.photoUrl ? 'Change photo' : 'Add a photo'}
                </Button>
                {draft.photoUrl && (
                  <Button type="text" danger size="small" onClick={() => setDraft({ ...draft, photo: null, photoUrl: null })}>
                    Remove photo
                  </Button>
                )}
              </Space>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pickPhoto(e.target.files?.[0])} />
            </div>
            <Segmented
              block
              value={draft.group}
              onChange={(v) => setDraft({ ...draft, group: v as PersonGroup })}
              options={[
                { label: 'Serving today', value: 'leadership' },
                { label: 'Founder', value: 'founders' },
              ]}
            />
            <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={80} placeholder="Name" aria-label="Name" />
            <AutoComplete
              value={draft.role}
              onChange={(v) => setDraft({ ...draft, role: v })}
              options={ROLE_OPTIONS}
              filterOption={(input, option) => (option?.value ?? '').toLowerCase().includes(input.toLowerCase())}
              placeholder="Role, e.g. President, Imam, Muaddin"
              maxLength={60}
              aria-label="Role"
              style={{ width: '100%' }}
            />
            <Input value={draft.since} onChange={(e) => setDraft({ ...draft, since: e.target.value })} maxLength={30} placeholder='Optional, e.g. "Since 2019" or "2004 - 2015"' aria-label="Since" />
          </Space>
        )}
      </Modal>
    </Card>
  );
}
