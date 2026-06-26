-- Club icons: nullable SVG markup stored per club, rendered before the club name
-- and before member players' names in the UI. Rendered via <img> data-URI on the
-- frontend and validated server-side, so no script execution is possible.
ALTER TABLE clubs ADD COLUMN icon_svg TEXT NULL;

-- Starter icons for the two seeded clubs.
-- "Синие люди": a blue meeple (board-game pawn) beneath a square-root (radical) sign.
UPDATE clubs SET icon_svg =
'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><path d="M2 14 H3.6 L6.2 21.5 L9.2 4 H22" stroke="#1d4ed8" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="15.8" cy="9.2" r="2.1" fill="#2563eb"/><path d="M14.4 11 L12 12.1 L11.7 13.6 L14.2 14 L12.6 21 L15.1 21 L15.8 17.4 L16.5 21 L19 21 L17.4 14 L19.9 13.6 L19.6 12.1 L17.2 11 Z" fill="#2563eb"/></svg>'
WHERE name = 'Синие люди';

-- "Весёлые карточные игры": a three-leaf clover (shamrock) with a stem, gradient-shaded leaves.
UPDATE clubs SET icon_svg =
'<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="leafGrad" cx="50%" cy="38%" r="65%"><stop offset="0%" stop-color="#78d156"/><stop offset="55%" stop-color="#43a040"/><stop offset="100%" stop-color="#1d6527"/></radialGradient><linearGradient id="stemGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#4ea540"/><stop offset="100%" stop-color="#2a6e2f"/></linearGradient><g id="leaf"><path d="M0,0 C0,0 -40,-35 -40,-60 C-40,-75 -25,-85 -10,-75 C-5,-72 0,-65 0,-60 C0,-65 5,-72 10,-75 C25,-85 40,-75 40,-60 C40,-35 0,0 0,0 Z" fill="url(#leafGrad)" stroke="#143f1c" stroke-width="3.5" stroke-linejoin="round"/><path d="M0,0 C0,0 -40,-35 -40,-60 C-40,-75 -25,-85 -10,-75 C-5,-72 0,-65 0,-60 C0,-65 5,-72 10,-75 C25,-85 40,-75 40,-60 C40,-35 0,0 0,0 Z" fill="none" stroke="#aae87b" stroke-width="2.4" opacity="0.5" transform="translate(0,-14) scale(0.62)"/><circle cx="0" cy="-56" r="8" fill="none" stroke="#c8f29a" stroke-width="2.4" opacity="0.5"/></g></defs><path d="M94,96 C92,118 92,150 96,176 L104,176 C108,150 108,118 106,96 Z" fill="url(#stemGrad)" stroke="#143f1c" stroke-width="3" stroke-linejoin="round"/><g transform="translate(100,92) scale(0.95)"><use href="#leaf" transform="rotate(0)"/><use href="#leaf" transform="rotate(120)"/><use href="#leaf" transform="rotate(240)"/></g></svg>'
WHERE name = 'Весёлые карточные игры';
