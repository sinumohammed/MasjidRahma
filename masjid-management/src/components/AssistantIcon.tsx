import { useId } from 'react';

// The assistant's mark: a masjid dome with a crescent on top, as the head of
// a friendly bot (visor, two eyes, ears) - the masjid's own helper, not a
// generic robot. `bare`: no green disc behind it (the launcher button has
// its own background).
export default function AssistantIcon({ size = 32, bare = false }: { size?: number; bare?: boolean }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden focusable="false" className="assistant-icon">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1f9a74" />
          <stop offset="0.55" stopColor="#0f6b52" />
          <stop offset="1" stopColor="#0b3d2f" />
        </linearGradient>
        <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fde68a" />
          <stop offset="1" stopColor="#f59e0b" />
        </linearGradient>
      </defs>
      {!bare && <circle cx="32" cy="32" r="32" fill={`url(#${id}-bg)`} />}
      {/* crescent finial */}
      <path d="M34.4 5.6a3.6 3.6 0 1 0 0 6.4a2.9 2.9 0 1 1 0-6.4z" fill={`url(#${id}-gold)`} />
      <rect x="31.2" y="11.6" width="1.6" height="3" rx="0.8" fill={`url(#${id}-gold)`} />
      {/* onion dome */}
      <path d="M19.5 31.5c0-6.6 5.6-10.6 9-13.6c1.6-1.4 2.9-2.7 3.5-4c.6 1.3 1.9 2.6 3.5 4c3.4 3 9 7 9 13.6z" fill="#ffffff" fillOpacity="0.96" />
      {/* ears */}
      <rect x="13" y="36" width="4" height="9" rx="2" fill="#ffffff" fillOpacity="0.9" />
      <rect x="47" y="36" width="4" height="9" rx="2" fill="#ffffff" fillOpacity="0.9" />
      {/* face, visor, eyes */}
      <rect x="16.5" y="29.5" width="31" height="21" rx="7.5" fill="#ffffff" />
      <rect x="20.5" y="34.5" width="23" height="11" rx="5.5" fill="#0b3d2f" />
      <circle cx="27" cy="40" r="2.5" fill="#8fe0c2" />
      <circle cx="37" cy="40" r="2.5" fill="#8fe0c2" />
      {/* a spark: it thinks */}
      <path d="M51 12.5l1.1 2.6l2.6 1.1l-2.6 1.1L51 19.9l-1.1-2.6l-2.6-1.1l2.6-1.1z" fill={`url(#${id}-gold)`} />
    </svg>
  );
}
