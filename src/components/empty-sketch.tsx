/** 手绘风空笔记本：空状态用的插画，歪一点才有体温 */
export function EmptySketch({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 120" fill="none" className={className} aria-hidden="true">
      <g transform="rotate(-2 80 62)">
        <rect x="30" y="20" width="102" height="86" rx="8" fill="var(--card)" stroke="#1f2937" strokeWidth="2.5" />
        {[46, 66, 86, 106].map((x) => (
          <circle key={x} cx={x} cy="20" r="3.5" stroke="#1f2937" strokeWidth="2" fill="var(--background)" />
        ))}
        <path d="M44 46 C 70 42, 98 48, 118 44" stroke="#a8a29e" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M44 62 C 68 59, 96 64, 116 60" stroke="#a8a29e" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M44 78 C 62 76, 88 80, 106 76" stroke="#a8a29e" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M42 94 L 98 90" stroke="#facc15" strokeWidth="9" strokeLinecap="round" opacity="0.65" />
        <path d="M44 93 C 62 91, 86 93, 100 90" stroke="#1f2937" strokeWidth="2" strokeLinecap="round" />
      </g>
      <path d="M120 100 L 140 78" stroke="#1f2937" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M140 78 l 5 -5" stroke="#facc15" strokeWidth="4" strokeLinecap="round" />
      <circle cx="26" cy="104" r="2" fill="#a8a29e" />
      <circle cx="142" cy="30" r="2" fill="#a8a29e" />
    </svg>
  );
}
