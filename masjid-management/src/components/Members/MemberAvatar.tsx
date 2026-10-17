import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { UserOutlined } from '@ant-design/icons';
import { memberPhotoUrl, MEMBER_PHOTO_EVENT } from '../../services/api';
import './MemberAvatar.css';

const EXTENSIONS = ['png', 'jpg', 'jpeg', 'JPG'] as const;

interface MemberAvatarProps {
  // Falsy (e.g. a transaction with no linked member) skips the photo lookup
  // entirely and renders the fallback icon straight away.
  uniqueId: string | null | undefined;
  size?: number;
  fallbackIcon?: ReactNode;
  className?: string;
}

// '#' (as in 'MR#001') breaks static asset lookups even when percent-encoded,
// so the file naming convention strips all non-alphanumeric characters.
function assetFileName(uniqueId: string): string {
  return uniqueId.replace(/[^a-zA-Z0-9]/g, '');
}

// Where a member's photo may be, in order: the photo uploaded in the app
// (the member's edit form), then the older files in public/assets/members/
// (.JPG too: Vercel's file names are case-sensitive).
function sources(uniqueId: string, version: number): string[] {
  const file = assetFileName(uniqueId);
  return [memberPhotoUrl(uniqueId, version), ...EXTENSIONS.map((ext) => `/assets/members/${file}.${ext}`)];
}

// Callers must pass `key={uniqueId}` so React remounts (rather than updates)
// this component when the member changes - otherwise the source index would
// carry over from the previous member and briefly show a stale photo.
export default function MemberAvatar({ uniqueId, size = 56, fallbackIcon, className }: MemberAvatarProps) {
  const [index, setIndex] = useState(0);
  const [version, setVersion] = useState(0);

  // A photo changed on this screen: try again from the uploaded one.
  useEffect(() => {
    const onUpdated = (e: Event) => {
      if ((e as CustomEvent<string>).detail === uniqueId) {
        setVersion(Date.now());
        setIndex(0);
      }
    };
    window.addEventListener(MEMBER_PHOTO_EVENT, onUpdated);
    return () => window.removeEventListener(MEMBER_PHOTO_EVENT, onUpdated);
  }, [uniqueId]);

  const style = { width: size, height: size, fontSize: Math.round(size * 0.55) };
  const list = uniqueId ? sources(uniqueId, version) : [];

  if (index >= list.length) {
    return (
      <div className={`member-avatar-icon ${className || ''}`} style={style}>
        {fallbackIcon ?? <UserOutlined />}
      </div>
    );
  }

  return (
    <img
      src={list[index]}
      alt={uniqueId ?? ''}
      className={`member-avatar-photo ${className || ''}`}
      style={style}
      onError={() => setIndex((i) => i + 1)}
    />
  );
}
