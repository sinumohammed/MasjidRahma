import { useState } from 'react';
import type { ReactNode } from 'react';
import { UserOutlined } from '@ant-design/icons';
import './MemberAvatar.css';

const EXTENSIONS = ['png', 'jpg', 'jpeg'] as const;
type Extension = (typeof EXTENSIONS)[number];

interface MemberAvatarProps {
  uniqueId: string;
  size?: number;
  fallbackIcon?: ReactNode;
  className?: string;
}

// '#' (as in 'MR#001') breaks static asset lookups even when percent-encoded,
// so the file naming convention strips all non-alphanumeric characters.
function assetFileName(uniqueId: string): string {
  return uniqueId.replace(/[^a-zA-Z0-9]/g, '');
}

// Callers must pass `key={uniqueId}` so React remounts (rather than updates)
// this component when the member changes - otherwise extIndex would carry
// over from the previous member and briefly show a stale fallback/attempt.
export default function MemberAvatar({ uniqueId, size = 56, fallbackIcon, className }: MemberAvatarProps) {
  const [extIndex, setExtIndex] = useState(0);

  const style = { width: size, height: size, fontSize: Math.round(size * 0.55) };

  if (extIndex >= EXTENSIONS.length) {
    return (
      <div className={`member-avatar-icon ${className || ''}`} style={style}>
        {fallbackIcon ?? <UserOutlined />}
      </div>
    );
  }

  const ext: Extension = EXTENSIONS[extIndex];
  const fileName = assetFileName(uniqueId);

  return (
    <img
      src={`/assets/members/${fileName}.${ext}`}
      alt={uniqueId}
      className={`member-avatar-photo ${className || ''}`}
      style={style}
      onError={() => setExtIndex((i) => i + 1)}
    />
  );
}
