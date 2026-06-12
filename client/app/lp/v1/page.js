"use client";

/* V1 — 满幅瀑布墙（Midjourney / Krea 风格）
   边到边的 masonry 大图墙，悬停浮出案例信息，顶部统计条。 */

import { CASES, LpShell } from "../_shared";

export default function V1() {
  return (
    <LpShell variant="V1" title={<>作品自己说话，<span className="brand-gradient-text">满幅铺开</span></>}>
      {/* 统计条 */}
      <div className="flex justify-center gap-10 pb-10 micro-label">
        <span><span className="text-white text-base font-display font-extrabold">14</span>&nbsp;真实案例</span>
        <span><span className="text-white text-base font-display font-extrabold">3</span>&nbsp;垂直场景</span>
        <span><span className="text-white text-base font-display font-extrabold">0</span>&nbsp;人工修饰</span>
      </div>

      {/* 满幅 masonry：无容器宽度限制 */}
      <div className="px-2 sm:px-3 pb-24 columns-2 md:columns-3 xl:columns-4 gap-3">
        {CASES.map((c) => (
          <figure key={c.f} className="group relative mb-3 break-inside-avoid rounded-sm overflow-hidden border border-white/[0.07] hover:border-white/30 transition-all duration-500">
            <img src={`/showcase/${c.f}`} alt={c.label} loading="lazy"
              className="w-full block group-hover:scale-[1.03] transition-transform duration-700" />
            {/* 悬停信息层 */}
            <figcaption className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-4">
              <span className="micro-label">// {c.scene}</span>
              <span className="text-white text-[15px] font-bold mt-1">{c.label}</span>
              <span className="text-gray-400 text-[11px] mt-0.5">{c.brief}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </LpShell>
  );
}
