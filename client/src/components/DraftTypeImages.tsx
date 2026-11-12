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

/** Three packs passing around a table, for the normal draft choice. */
export function NormalDraftImage() {
  return (
    <svg viewBox="0 0 120 120" width="96" height="96" aria-hidden="true" focusable="false">
      <circle cx="60" cy="60" r="37" fill="none" stroke="#4a32c4" strokeWidth="5" />
      <g fill="#4a32c4">
        <polygon points="96,48 96,32 82,40" />
        <polygon points="52,97 66,105 66,89" />
        <polygon points="32,35 18,43 32,51" />
      </g>
      <g stroke="var(--bg)" strokeWidth="2">
        <rect x="44" y="2" width="32" height="42" rx="4" fill="#8f7bff" />
        <rect x="76" y="58" width="32" height="42" rx="4" fill="#6a4cff" />
        <rect x="12" y="58" width="32" height="42" rx="4" fill="#4a32c4" />
      </g>
      <g fill="var(--bg)" opacity="0.35">
        <rect x="48" y="7" width="24" height="5" rx="1" />
        <rect x="80" y="63" width="24" height="5" rx="1" />
        <rect x="16" y="63" width="24" height="5" rx="1" />
      </g>
    </svg>
  );
}

/** A face-down stack feeding three piles, for the Winston draft choice. */
export function WinstonDraftImage() {
  return (
    <svg viewBox="0 0 120 120" width="96" height="96" aria-hidden="true" focusable="false">
      <g stroke="#4a32c4" strokeWidth="4" strokeLinecap="round" fill="none">
        <path d="M60 58 L22 70" />
        <path d="M60 58 L60 68" />
        <path d="M60 58 L98 70" />
      </g>
      <g stroke="var(--bg)" strokeWidth="2">
        <rect x="48" y="4" width="36" height="48" rx="4" fill="#4a32c4" />
        <rect x="44" y="7" width="36" height="48" rx="4" fill="#6a4cff" />
        <rect x="40" y="10" width="36" height="48" rx="4" fill="#8f7bff" />
        <rect x="7" y="74" width="30" height="40" rx="3" fill="#6a4cff" />
        <rect x="51" y="68" width="30" height="40" rx="3" fill="#4a32c4" />
        <rect x="48" y="71" width="30" height="40" rx="3" fill="#6a4cff" />
        <rect x="45" y="74" width="30" height="40" rx="3" fill="#8f7bff" />
        <rect x="86" y="71" width="30" height="40" rx="3" fill="#4a32c4" />
        <rect x="83" y="74" width="30" height="40" rx="3" fill="#6a4cff" />
      </g>
      <g fill="var(--bg)" opacity="0.35">
        <ellipse cx="58" cy="34" rx="9" ry="14" />
        <ellipse cx="22" cy="94" rx="7" ry="11" />
        <ellipse cx="60" cy="94" rx="7" ry="11" />
        <ellipse cx="98" cy="94" rx="7" ry="11" />
      </g>
    </svg>
  );
}
