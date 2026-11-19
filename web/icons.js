// Line icons (24×24, drawn with currentColor) for masks and controls.

const P = {
  background: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 15.5l4.5-4.5 3.5 3.5"/><path d="M14 11l7 7"/><circle cx="15.5" cy="14.5" r="2.2" fill="currentColor" stroke="none" opacity=".35"/><path d="M12.6 20c.4-2.4 1.5-3.6 2.9-3.6s2.5 1.2 2.9 3.6" fill="currentColor" stroke="none" opacity=".35"/>',
  "background-no-sky": '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 15l4.5-4.5L12 15l3-3 6 6"/><path d="M6 8.2h12" stroke-dasharray="1.6 2"/>',
  subject: '<circle cx="12" cy="8" r="3.6"/><path d="M4.8 20.5c1.3-4.3 4-6.4 7.2-6.4s5.9 2.1 7.2 6.4"/>',
  sky: '<path d="M7.2 18.5h9.6a4 4 0 0 0 .6-7.95 6 6 0 0 0-11.5-.9A4.4 4.4 0 0 0 7.2 18.5z"/>',
  "not-sky": '<path d="M7.2 18.5h9.6a4 4 0 0 0 .6-7.95 6 6 0 0 0-11.5-.9A4.4 4.4 0 0 0 7.2 18.5z"/><path d="M4 4l16 16"/>',
  "not-people": '<circle cx="12" cy="8" r="3.4"/><path d="M5 20.5c1.3-4.2 3.9-6.2 7-6.2s5.7 2 7 6.2"/><path d="M4 4l16 16"/>',
  people: '<circle cx="9" cy="8.5" r="3"/><path d="M3 19.5c1-3.6 3.2-5.3 6-5.3s5 1.7 6 5.3"/><circle cx="16.5" cy="7.5" r="2.5"/><path d="M15.5 13.3c2.6-.3 4.5 1.3 5.5 4.7"/>',
  skin: '<path d="M8 21v-5.5L5.5 12a1.6 1.6 0 0 1 2.6-1.8L9 11.5V5a1.5 1.5 0 0 1 3 0v5.5V3.8a1.5 1.5 0 0 1 3 0v6.7V5.5a1.5 1.5 0 0 1 3 0V15c0 3.3-2 6-5.5 6z"/>',
  "face-skin": '<ellipse cx="12" cy="12" rx="7" ry="8.5"/><path d="M9.3 10.5h.01M14.7 10.5h.01"/><path d="M9.5 15c1.4 1.2 3.6 1.2 5 0"/>',
  "body-skin": '<path d="M8 3.5c0 2.2 1.8 3.5 4 3.5s4-1.3 4-3.5"/><path d="M6.5 8.5c-1 1.5-1.5 4-1.2 7"/><path d="M17.5 8.5c1 1.5 1.5 4 1.2 7"/><path d="M8 9v11.5h8V9"/>',
  hair: '<path d="M5 13c0-5 3-8.5 7-8.5s7 3.5 7 8.5"/><path d="M5 13c.5 3 1 5.5 2.5 7.5M19 13c-.5 3-1 5.5-2.5 7.5"/><path d="M8.5 6.5c1 2.5 3.5 4 7 4.5"/>',
  eyes: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.8"/>',
  eyebrows: '<path d="M3.5 10c1.8-2.4 4.6-3 7-1.8"/><path d="M20.5 10c-1.8-2.4-4.6-3-7-1.8"/><path d="M5 15.5s1.5-1.5 3.5-1.5 3.5 1.5 3.5 1.5M12 15.5s1.5-1.5 3.5-1.5 3.5 1.5 3.5 1.5" opacity=".45"/>',
  lips: '<path d="M2.5 12c2-2.6 4-4 5.8-4 1.4 0 2.5.8 3.7 1.6C13.2 8.8 14.3 8 15.7 8c1.8 0 3.8 1.4 5.8 4-2.4 3.4-5.6 5-9.5 5S4.9 15.4 2.5 12z"/><path d="M2.5 12h19"/>',
  teeth: '<path d="M7 3.5c1.6 0 2.8.8 5 .8s3.4-.8 5-.8c2.4 0 3.5 2.2 3 5-.5 2.5-1.7 3.8-2.2 6.5-.4 2.5-.9 5.5-2.3 5.5-1.7 0-1.6-5-3.5-5s-1.8 5-3.5 5c-1.4 0-1.9-3-2.3-5.5C6.7 12.3 5.5 11 5 8.5c-.5-2.8.6-5 2-5z"/>',
  "facial-hair": '<path d="M5 9c0 6 2.8 11 7 11s7-5 7-11"/><path d="M8 12.5c1.2-.8 2.6-1 4-1s2.8.2 4 1"/><path d="M10 15.5h4"/>',
  clothes: '<path d="M8.5 3.5L3.5 6.5l2 4 2.5-1V20.5h8V9.5l2.5 1 2-4-5-3c-.8 1.4-2 2.2-3.5 2.2S9.3 4.9 8.5 3.5z"/>',
  mountains: '<path d="M2 20l6.5-11 4 6.5 2.8-4L22 20z"/><path d="M6.6 12.2l1.9 1.5 1.6-1.4"/>',
  water: '<path d="M2.5 9c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 3-1.5"/><path d="M2.5 13.5c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 3-1.5"/><path d="M2.5 18c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 3-1.5"/>',
  vegetation: '<path d="M12 21v-6"/><path d="M12 3c3.6 0 6 2.8 6 6 0 3.5-2.7 6-6 6s-6-2.5-6-6c0-3.2 2.4-6 6-6z"/><path d="M12 15l-3-3M12 13l3-3"/>',
  architecture: '<path d="M4 21V9l8-5.5L20 9v12"/><path d="M2.5 21h19"/><path d="M8 21v-7h3v7M13.5 13.5h3v3h-3z"/>',
  "natural-ground": '<path d="M2.5 17c3-2 6-2.5 9.5-2.5s6.5.5 9.5 2.5"/><path d="M2.5 21h19"/><path d="M7 14.5V11M7 11l-1.5-1.5M7 11.8l1.5-1.6M16.5 14.7v-4M16.5 10.7L15 9.2M16.5 11.5l1.5-1.6"/>',
  "artificial-ground": '<path d="M9.5 3.5L4 20.5M14.5 3.5L20 20.5"/><path d="M12 5v2.5M12 10.5v3M12 16.5v4"/>',
  snow: '<path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6"/><path d="M9.5 4l2.5 2 2.5-2M9.5 20l2.5-2 2.5 2"/>',

  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2.2h6.5A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>',
  file: '<path d="M6.5 3h7.5l4.5 4.5v11.5a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2v-14a2 2 0 0 1 2-2z"/><path d="M14 3v5h4.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  // Apps are drawn as generic things (a cloud, a display, a camera), never as anyone's app icon or lettermark.
  "cloud-photos": '<path d="M7 19h10.2a4 4 0 0 0 .5-7.96 6 6 0 0 0-11.5-.84A4.4 4.4 0 0 0 7 19z"/><path d="M8.6 16.6l2.6-2.9 2 2 1.6-1.5 2.4 2.4"/>',
  reveal: '<path d="M14 4h6v6"/><path d="M20 4l-8.5 8.5"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6h.01"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4.5V11h-6.5"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5"/><path d="M4.5 20h15"/>',
  stack: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5" opacity=".6"/>',
  warning: '<path d="M12 4l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.3h.01"/>',
  "desktop-photos": '<rect x="3" y="4" width="18" height="12.5" rx="2"/><path d="M9 20.5h6M12 16.5v4"/><path d="M6.5 13.5l3.2-3.3 2.3 2.3 2-1.8 3.5 2.8"/><circle cx="15.8" cy="8.2" r="1.1"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.8"/><rect x="13" y="4" width="7" height="7" rx="1.8"/><rect x="4" y="13" width="7" height="7" rx="1.8"/><rect x="13" y="13" width="7" height="7" rx="1.8"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.8" cy="6.5" r=".9" fill="currentColor"/><circle cx="4.8" cy="12" r=".9" fill="currentColor"/><circle cx="4.8" cy="17.5" r=".9" fill="currentColor"/>',
  sidebar: '<rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="M9.5 4.5v15"/><path d="M5.6 8.3h1.6M5.6 11h1.6" opacity=".7"/>',
  inspector: '<rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="M14.5 4.5v15"/><path d="M16.8 8.3h1.6M16.8 11h1.6" opacity=".7"/>',
  down: '<path d="M7 10l5 5 5-5"/>',
  combine: '<circle cx="9" cy="12" r="5.6"/><circle cx="15" cy="12" r="5.6"/>',
  history: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4 4.5v3.8h3.8"/><path d="M12 8v4.2l2.8 1.8"/>',
  up: '<path d="M7 14l5-5 5 5"/>',
  ellipsis: '<circle cx="6" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18" cy="12" r="1.3" fill="currentColor"/>',
  masks: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M3.5 15.5c3-2.8 5.6-4 8.5-4s5.5 1.2 8.5 4"/><circle cx="12" cy="8" r="2.4"/>',
  group: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"/><path d="M8 9.5h8M8 13h5"/>',
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.8v1.9M12 19.3v1.9M5.5 5.5l1.35 1.35M17.15 17.15l1.35 1.35M2.8 12h1.9M19.3 12h1.9M5.5 18.5l1.35-1.35M17.15 6.85l1.35-1.35"/>',
  moon: '<path d="M19.6 14.6A8 8 0 0 1 9.4 4.4a8 8 0 1 0 10.2 10.2z"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>',
  camera: '<path d="M4 9a2 2 0 0 1 2-2h2.2l1.5-2.2h4.6L15.8 7H18a2 2 0 0 1 2 2v8.2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="12.8" r="3.6"/>',
};

export function icon(name, size = 18) {
  const body = P[name] || P.info;
  const span = document.createElement("span");
  span.className = "icon";
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  return span;
}

export const hasIcon = (name) => name in P;
