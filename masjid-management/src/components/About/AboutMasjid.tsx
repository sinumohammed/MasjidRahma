import { useEffect, useState } from 'react';
import { Button, Skeleton } from 'antd';
import { EnvironmentOutlined, CalendarOutlined, LoginOutlined } from '@ant-design/icons';
import { getAbout, aboutPhotoUrl, type About, type MasjidPerson } from '../../services/api';
import './AboutMasjid.css';

// About the masjid: its story and the people behind it - today's leadership
// first, then the founders. On a guest's home page (variant "home", with a
// small log-in invitation) and as its own page from the menu. Edited by the
// admin in Settings (AboutSettingsCard).

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

export function PersonPhoto({ person, size }: { person: Pick<MasjidPerson, 'name' | 'photoUrl'>; size: number }) {
  return person.photoUrl ? (
    <img className="about-photo" src={person.photoUrl.startsWith('data:') ? person.photoUrl : aboutPhotoUrl(person.photoUrl)} alt={person.name} width={size} height={size} loading="lazy" />
  ) : (
    <span className="about-photo about-photo-initials" style={{ width: size, height: size, fontSize: size * 0.34 }} aria-hidden>
      {initials(person.name) || '?'}
    </span>
  );
}

function PersonCard({ person }: { person: MasjidPerson }) {
  return (
    <figure className="about-person">
      <PersonPhoto person={person} size={112} />
      <figcaption>
        {person.role && <span className="about-person-role">{person.role}</span>}
        <span className="about-person-name">{person.name}</span>
        {person.since && <span className="about-person-since">{person.since}</span>}
      </figcaption>
    </figure>
  );
}

interface AboutMasjidProps {
  variant?: 'home' | 'page';
  onLogin?: () => void;
}

export default function AboutMasjid({ variant = 'page', onLogin }: AboutMasjidProps) {
  const [about, setAbout] = useState<About | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getAbout()
      .then(setAbout)
      .catch(() => setFailed(true));
  }, []);

  const leadership = about?.people.filter((p) => p.group === 'leadership') ?? [];
  const founders = about?.people.filter((p) => p.group === 'founders') ?? [];
  const story = (about?.story ?? '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const filledIn = Boolean(about && (story.length || about.people.length || about.tagline));

  const loginInvite = variant === 'home' && onLogin && (
    <div className="about-login">
      <div>
        <strong>Are you a member?</strong>
        <span>Log in to see your dues, payments and duty days.</span>
      </div>
      <Button type="primary" icon={<LoginOutlined />} onClick={onLogin}>
        Log in
      </Button>
    </div>
  );

  if (!about && !failed) {
    return (
      <div className="about-masjid">
        <div className="about-intro">
          <Skeleton active paragraph={{ rows: 3 }} />
        </div>
      </div>
    );
  }

  return (
    <div className={`about-masjid is-${variant}`}>
      <section className="about-intro">
        <span className="about-eyebrow">About</span>
        <h2>Masjid Rahma</h2>
        {about?.tagline && <p className="about-tagline">{about.tagline}</p>}
        {(about?.founded || about?.address) && (
          <div className="about-meta">
            {about.founded && (
              <span>
                <CalendarOutlined /> Founded {about.founded}
              </span>
            )}
            {about.address && (
              <span>
                <EnvironmentOutlined /> {about.address}
              </span>
            )}
          </div>
        )}
        {story.map((p, i) => (
          <p key={i} className="about-story">
            {p}
          </p>
        ))}
        {!filledIn && (
          <p className="about-story about-empty">
            {failed ? 'Could not load this right now - please try again later.' : 'A place of prayer and community. More about the masjid and the people behind it soon.'}
          </p>
        )}
      </section>

      {leadership.length > 0 && (
        <section className="about-people">
          <h3>Serving the masjid today</h3>
          <div className="about-people-grid">
            {leadership.map((p) => (
              <PersonCard key={p.id} person={p} />
            ))}
          </div>
        </section>
      )}

      {founders.length > 0 && (
        <section className="about-people is-founders">
          <h3>The founders</h3>
          <p className="about-people-note">The people who started Masjid Rahma.</p>
          <div className="about-people-grid">
            {founders.map((p) => (
              <PersonCard key={p.id} person={p} />
            ))}
          </div>
        </section>
      )}

      {loginInvite}
    </div>
  );
}
