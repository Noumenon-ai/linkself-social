// The link mark from the approved Glass reference, shared by studio and auth.
export const GlassBrand = ({ wordmark = false }: { wordmark?: boolean }) => (
  <span className="glass-brand" aria-label="LinkSelf Social">
    <svg viewBox="0 0 192 192" width="36" height="36" aria-hidden="true">
      <rect rx="56" width="192" height="192" fill="currentColor" />
      <g fill="none" stroke="var(--studio-ground)" strokeWidth="12" strokeLinecap="round">
        <path d="M128 69Q134 53 114 53H84C46 53 46 107 84 107H109" />
        <path d="M64 123Q58 135 78 135H108C146 135 146 80 108 80H83" />
      </g>
    </svg>
    {wordmark && <span>LinkSelf Social</span>}
  </span>
);
