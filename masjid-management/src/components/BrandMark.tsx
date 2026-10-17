// The masjid's mark: a dome with a crescent on its spire, in gold on the deep
// green. Used in the sidebar, the phone header and the login card.
export default function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Masjid Rahma" className="brand-mark">
      <rect width="48" height="48" rx="13" fill="#0f6b52" />
      <rect x="1" y="1" width="46" height="46" rx="12" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
      {/* crescent */}
      <path d="M24.6 6.2a3.6 3.6 0 1 0 2.6 6.1 3 3 0 1 1-2.6-6.1z" fill="#e9c46a" />
      {/* spire */}
      <rect x="23.3" y="12.4" width="1.4" height="4.2" rx="0.7" fill="#e9c46a" />
      {/* dome */}
      <path d="M12 31c0-7.6 5.4-12.6 12-14.6 6.6 2 12 7 12 14.6z" fill="#e9c46a" />
      {/* base and doorway */}
      <rect x="10" y="31" width="28" height="9" rx="1.6" fill="#f6e7c1" />
      <path d="M21.4 40v-4.2a2.6 2.6 0 0 1 5.2 0V40z" fill="#0f6b52" />
    </svg>
  );
}
