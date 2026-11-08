// Hand-drawn line ornaments: botanical sprigs, cloud scrolls, the sun-eye mark
// and one emblem per realm. Stroke-based, coloured with currentColor.

import type { Emblem } from '../content';

const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export function SunEyeMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden focusable="false">
      <g {...line} strokeWidth={2.2}>
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i / 12) * Math.PI * 2;
          const r1 = 15, r2 = i % 2 ? 19 : 22;
          return <path key={i} d={`M${24 + Math.cos(a) * r1} ${24 + Math.sin(a) * r1}L${24 + Math.cos(a) * r2} ${24 + Math.sin(a) * r2}`} />;
        })}
        <circle cx="24" cy="24" r="11" />
        <path d="M15 24c3-4 6-6 9-6s6 2 9 6c-3 4-6 6-9 6s-6-2-9-6z" />
      </g>
      <circle cx="24" cy="24" r="2.6" fill="currentColor" />
    </svg>
  );
}

const leaf = (x: number, y: number, a: number, s = 1) => (
  <path d={`M0 0c5-7 15-9 22-4-5 7-15 9-22 4z`} transform={`translate(${x} ${y}) rotate(${a}) scale(${s})`} />
);

export function LeafDivider({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 320 32" className={className} aria-hidden focusable="false">
      <g {...line} strokeWidth={1.5}>
        <path d="M12 16h112M196 16h112" />
        {leaf(124, 16, 200)}
        {leaf(114, 16, 160, 0.8)}
        {leaf(196, 16, -20)}
        {leaf(206, 16, 20, 0.8)}
        <circle cx="160" cy="16" r="6" />
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i / 8) * Math.PI * 2;
          return <path key={i} d={`M${160 + Math.cos(a) * 9} ${16 + Math.sin(a) * 9}L${160 + Math.cos(a) * 13} ${16 + Math.sin(a) * 13}`} />;
        })}
      </g>
    </svg>
  );
}

export function Vine({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 220 220" className={className} aria-hidden focusable="false">
      <g {...line} strokeWidth={1.4}>
        <path d="M6 214C26 150 54 104 104 72s86-40 104-60" />
        <path d="M104 72c-10-14-8-30 6-36 12-5 22 6 16 16-4 6-12 5-13-1" />
        <path d="M58 136c-16-4-26 4-26 14 0 8 9 12 14 6" />
        {leaf(30, 168, -70)}
        {leaf(46, 128, -40)}
        {leaf(76, 100, -120, 0.9)}
        {leaf(128, 56, -20, 0.9)}
        {leaf(160, 40, -100, 0.8)}
        {leaf(186, 26, -30, 0.7)}
        <circle cx="70" cy="112" r="2.5" />
        <circle cx="150" cy="50" r="2" />
      </g>
    </svg>
  );
}

/** The artwork's cloud scroll, as an inline drawing. */
export function CloudScroll({ className, flip = false }: { className?: string; flip?: boolean }) {
  const circles: [number, number, number][] = [[34, 34, 14], [56, 26, 17], [80, 34, 13]];
  return (
    <svg viewBox="0 0 150 60" className={className} aria-hidden focusable="false" style={flip ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M92 40c18 0 28-6 50-22" fill="none" stroke="var(--cyan)" strokeWidth="9" strokeLinecap="round" />
      <path d="M92 40c18 0 28-6 50-22" fill="none" stroke="var(--aqua)" strokeWidth="4.5" strokeLinecap="round" />
      {circles.map(([x, y, r], i) => <circle key={`s${i}`} cx={x} cy={y} r={r} fill="none" stroke="var(--cyan)" strokeWidth="5" />)}
      {circles.map(([x, y, r], i) => <circle key={`f${i}`} cx={x} cy={y} r={r} fill="var(--aqua)" />)}
      <rect x="24" y="36" width="64" height="12" fill="var(--aqua)" />
      <path d="M22 48h68" stroke="var(--cyan)" strokeWidth="2.5" />
      {circles.map(([x, y, r], i) => (
        <path key={`c${i}`} d={`M${x} ${y + 1}a${r * 0.32} ${r * 0.32} 0 1 1 ${r * 0.3} ${r * 0.28}a${r * 0.55} ${r * 0.55} 0 1 1 -${r * 0.75} -${r * 0.45}`} fill="none" stroke="var(--cyan)" strokeWidth="2.2" strokeLinecap="round" />
      ))}
    </svg>
  );
}

export function RealmEmblem({ emblem, className }: { emblem: Emblem; className?: string }) {
  const paths: Record<Emblem, React.ReactNode> = {
    window: (
      <>
        <rect x="12" y="13" width="40" height="30" rx="4" />
        <path d="M24 52h16M32 43v9" />
        <path d="M32 37c0-8 6-12 12-12-1 7-5 12-12 12z" />
        <path d="M32 37c0-6-4-9-9-9 0 5 4 9 9 9z" />
      </>
    ),
    seed: (
      <>
        <path d="M32 52c-8 0-13-6-13-13 0-8 7-13 13-22 6 9 13 14 13 22 0 7-5 13-13 13z" />
        <path d="M32 52V30M32 38c4-2 6-5 7-8M32 44c-4-2-6-4-7-7" />
        <path d="M32 17c0-5 3-8 7-9" />
      </>
    ),
    wave: (
      <>
        <path d="M6 34c4 0 4-9 8-9s4 18 8 18 4-26 8-26 4 34 8 34 4-22 8-22 4 10 8 10 4-5 6-5" />
        <circle cx="50" cy="16" r="3.5" />
        <path d="M53.5 16V5l5 3" />
      </>
    ),
    book: (
      <>
        <path d="M32 21c-6-5-14-6-22-5v30c8-1 16 0 22 5 6-5 14-6 22-5V16c-8-1-16 0-22 5z" />
        <path d="M32 21v30M16 24c4 0 8 1 11 3M16 31c4 0 8 1 11 3M48 24c-4 0-8 1-11 3" />
      </>
    ),
    brush: (
      <>
        <path d="M44 9l11 11-19 19-8 3 3-8z" />
        <path d="M28 37c-7 0-11 4-11 9 0 4-3 6-7 7 9 2 19 0 21-9" />
        <path d="M40 13l11 11" />
      </>
    ),
    eye: (
      <>
        <path d="M8 36c6-9 14-14 24-14s18 5 24 14c-6 9-14 14-24 14S14 45 8 36z" />
        <circle cx="32" cy="36" r="7" />
        <path d="M32 8v7M19 12l3.5 6M45 12l-3.5 6" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden focusable="false">
      <g {...line}>{paths[emblem]}</g>
    </svg>
  );
}
