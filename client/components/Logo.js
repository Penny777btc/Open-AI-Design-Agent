/* Picsmith 品牌标识：方框 + 几何 P + 火花像素（匠人锻打的火星）。
   纯 SVG，currentColor 驱动，任意尺寸清晰。 */

export function PicsmithMark({ size = 28, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Picsmith logo"
    >
      {/* 外框（左下角开口，工业铭牌感） */}
      <path d="M8 2 H30 V24" stroke="currentColor" strokeWidth="2.5" />
      <path d="M24 30 H2 V8" stroke="currentColor" strokeWidth="2.5" />
      {/* 几何 P */}
      <path d="M11 25 V8 H20 a4.5 4.5 0 0 1 0 9 H11" stroke="currentColor" strokeWidth="3" />
      {/* 火花像素 */}
      <rect x="24" y="4" width="3" height="3" fill="currentColor" className="logo-spark" />
    </svg>
  );
}

export function PicsmithLockup({ markSize = 24, className = "" }) {
  return (
    <span className={`flex items-baseline gap-2.5 ${className}`}>
      <PicsmithMark size={markSize} className="self-center text-white" />
      <span className="font-display text-xl font-extrabold tracking-tighter brand-gradient-text">
        Picsmith
      </span>
      <span className="micro-label hidden sm:inline">图匠 // AI DESIGN AGENT</span>
    </span>
  );
}
