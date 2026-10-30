function placeIcons() {
  return `<span class="place-icons" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8.2v4.4l2.6 1.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><svg viewBox="0 0 24 24"><path d="M12 21s6-5.4 6-10a6 6 0 1 0-12 0c0 4.6 6 10 6 10z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="11" r="2.1" fill="currentColor"/></svg></span>`;
}

function clockArt(uid) {
  return `<svg class="art" viewBox="0 0 360 450" aria-hidden="true">
    <defs>
      <radialGradient id="face-${uid}" cx="42%" cy="38%" r="70%">
        <stop offset="0%" stop-color="#f7fffb"/>
        <stop offset="58%" stop-color="#d9f8e8"/>
        <stop offset="100%" stop-color="#b7ebD4"/>
      </radialGradient>
      <linearGradient id="rim-${uid}" x1="20%" y1="0%" x2="80%" y2="100%">
        <stop offset="0%" stop-color="#ffffff"/>
        <stop offset="38%" stop-color="#d7f3f6"/>
        <stop offset="72%" stop-color="#9fd0d8"/>
        <stop offset="100%" stop-color="#f4ffff"/>
      </linearGradient>
      <radialGradient id="bell-${uid}" cx="38%" cy="34%" r="70%">
        <stop offset="0%" stop-color="#ffffff"/>
        <stop offset="55%" stop-color="#e7fbff"/>
        <stop offset="100%" stop-color="#b7e0e8"/>
      </radialGradient>
      <filter id="glow-${uid}" x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur stdDeviation="14"/>
      </filter>
    </defs>
    <circle class="bell-glow" cx="104" cy="118" r="74" fill="#ff2a2a" filter="url(#glow-${uid})"/>
    <circle class="bell-glow" cx="256" cy="118" r="74" fill="#ff2a2a" filter="url(#glow-${uid})"/>
    <ellipse cx="118" cy="402" rx="34" ry="16" transform="rotate(-24 118 402)" fill="url(#rim-${uid})" stroke="rgba(255,255,255,0.8)" stroke-width="2"/>
    <ellipse cx="242" cy="402" rx="34" ry="16" transform="rotate(24 242 402)" fill="url(#rim-${uid})" stroke="rgba(255,255,255,0.8)" stroke-width="2"/>
    <circle cx="180" cy="248" r="152" fill="url(#rim-${uid})"/>
    <circle cx="180" cy="248" r="136" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="6"/>
    <circle cx="180" cy="248" r="126" fill="url(#face-${uid})"/>
    <circle cx="180" cy="248" r="126" fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="3"/>
    <path d="M78 150c-18 8-28 28-24 48" fill="none" stroke="rgba(255,255,255,0.75)" stroke-width="8" stroke-linecap="round"/>
    <path d="M150 108c8-34 52-34 60 0" fill="none" stroke="url(#rim-${uid})" stroke-width="16" stroke-linecap="round"/>
    <path d="M162 100c4-16 32-16 36 0" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="4" stroke-linecap="round"/>
    <circle cx="104" cy="118" r="58" fill="url(#rim-${uid})"/>
    <circle cx="104" cy="118" r="46" fill="url(#bell-${uid})"/>
    <ellipse cx="88" cy="102" rx="16" ry="10" fill="rgba(255,255,255,0.85)" transform="rotate(-24 88 102)"/>
    <circle cx="256" cy="118" r="58" fill="url(#rim-${uid})"/>
    <circle cx="256" cy="118" r="46" fill="url(#bell-${uid})"/>
    <ellipse cx="240" cy="102" rx="16" ry="10" fill="rgba(255,255,255,0.85)" transform="rotate(-24 240 102)"/>
    <path d="M118 96c22-8 40 10 62 8" fill="none" stroke="rgba(255,255,255,0.8)" stroke-width="7" stroke-linecap="round"/>
  </svg>`;
}

export function clockButton({ id, size, empty = false }) {
  const uid = `${size}-${id}`.replace(/[^a-zA-Z0-9_-]/g, "");
  return `<button type="button" class="clock clock-${size}${empty ? " clock-empty" : " is-live"}" data-id="${id}" data-size="${size}"${empty ? ' data-empty="1"' : ""}>
    ${clockArt(uid)}
    <span class="face">
      <span class="place">${placeIcons()}<span class="place-name" data-part="place"></span></span>
      <span class="digits" data-part="digits" lang="en">--:--:--</span>
      <span class="end-label">結束時間</span>
      <span class="end-pill" data-part="end" lang="en">--:--</span>
    </span>
  </button>`;
}
