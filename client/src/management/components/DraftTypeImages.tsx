/** A 3D cube in isometric view, for the cube draft choice. */
export function CubeImage() {
  return (
    <svg viewBox="0 0 120 120" width="96" height="96" aria-hidden="true" focusable="false">
      <g stroke="var(--bg)" strokeWidth="2" strokeLinejoin="round">
        <polygon points="60,12 104,36 60,60 16,36" fill="#8f7bff" />
        <polygon points="16,36 60,60 60,108 16,84" fill="#6a4cff" />
        <polygon points="104,36 104,84 60,108 60,60" fill="#4a32c4" />
      </g>
    </svg>
  );
}

/** A small fanned stack of cards, for the set draft choice. */
export function CardStackImage() {
  return (
    <svg viewBox="0 0 120 120" width="96" height="96" aria-hidden="true" focusable="false">
      <g stroke="var(--bg)" strokeWidth="2">
        <rect x="34" y="20" width="52" height="74" rx="6" fill="#4a32c4" transform="rotate(-14 60 94)" />
        <rect x="34" y="20" width="52" height="74" rx="6" fill="#6a4cff" transform="rotate(-2 60 94)" />
        <rect x="34" y="20" width="52" height="74" rx="6" fill="#8f7bff" transform="rotate(11 60 94)" />
      </g>
      <rect x="42" y="29" width="36" height="26" rx="2" fill="var(--bg)" opacity="0.35" transform="rotate(11 60 94)" />
    </svg>
  );
}
