"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { PicsmithMark } from "@/components/Logo";
import SiteFooter, { LangSwitch } from "@/components/SiteFooter";
import { useLang } from "@/context/LanguageContext";
import { COPY } from "@/lib/copy";

/* Picsmith（图匠）落地页 — 双语（zh/en）
   案例全部来自产品真实生成；brief 为发给 Agent 的中文提示词（两种语言下均可执行）。 */

const ROTATING = {
  zh: [
    ["咖啡品牌", "小红书封面"],
    ["保温杯新品", "电商主图"],
    ["年度汇报", "PPT 封面"],
    ["手冲咖啡店", "Logo 方案"],
    ["露营装备", "促销海报"],
  ],
  en: [
    ["coffee brand", "social cover"],
    ["new thermos", "product hero"],
    ["annual review", "deck cover"],
    ["coffee shop", "logo set"],
    ["camping gear", "promo poster"],
  ],
};

const CATEGORIES = [
  {
    key: "电商设计", en: "E-COMMERCE",
    items: [
      { f: "ec-thermos-hero.webp", label: "白底主图", enLabel: "White-bg hero", brief: "为不锈钢保温杯生成一张白底电商主图，影棚级打光，可直接上架" },
      { f: "ec-sneaker-hero.webp", label: "运动鞋主图", enLabel: "Sneaker hero", brief: "为白橙配色跑鞋生成一张悬浮角度的白底电商主图，动感构图" },
      { f: "ec-thermos-scene.webp", label: "户外场景图", enLabel: "Outdoor scene", badge: true, brief: "把这张白底保温杯主图改成黄金时刻的露营溪流场景，产品保持完全一致" },
      { f: "ec-skincare-scene.webp", label: "场景化主图", enLabel: "Lifestyle shot", brief: "为琥珀色精华液瓶生成一张晨光石板上的场景化主图，氛围种草感" },
      { f: "ec-lipstick-luxury.webp", label: "美妆大片", enLabel: "Beauty editorial", brief: "为玫瑰金口红生成一张黑丝绸背景的奢华美妆广告图，戏剧性打光" },
      { f: "ec-promo-poster.webp", label: "大促海报", enLabel: "Sale poster", brief: "做一张竖版电商大促海报，标题「年中大促」副标题「全场5折起」，红金配色喜庆氛围" },
      { f: "ec-food-poster.webp", label: "外卖海报", enLabel: "Food promo", brief: "做一张竖版美食外卖海报，标题「新店开业」副标题「第二份半价」，汉堡奶茶诱人摄影" },
      { f: "ec-watch-detail.webp", label: "细节大片", enLabel: "Macro detail", brief: "为机械腕表生成一张微距细节横幅，侧光突出表盘质感，暗调背景" },
      { f: "ec-banner-coffee.webp", label: "详情 Banner", enLabel: "Detail banner", brief: "为精品咖啡豆做一张 16:9 详情页头图，牛皮纸袋和咖啡豆，暖棕色调" },
    ],
  },
  {
    key: "自媒体配图", en: "SOCIAL MEDIA",
    items: [
      { f: "social-rednote.webp", label: "小红书封面", enLabel: "RedNote cover", brief: "做一张小红书封面，标题「7天收纳改造计划」，明亮治愈的家居整理风格" },
      { f: "social-bilibili.webp", label: "B站封面", enLabel: "Video cover", brief: "做一张 16:9 视频封面，超大标题「3分钟看懂AI」，蓝白科技感高对比构图" },
      { f: "social-douyin.webp", label: "竖版知识封面", enLabel: "Vertical cover", brief: "做一张竖版短视频知识封面，标题「早起的5个习惯」，日出渐变背景元气风" },
      { f: "social-youtube.webp", label: "YouTube 缩略图", enLabel: "YouTube thumb", brief: "做一张 YouTube 缩略图，文字 AI TOOLS 2026，人物指向发光手机，高点击率构图" },
      { f: "social-wechat-banner.webp", label: "公众号头图", enLabel: "Article banner", brief: "做一张公众号头图，书本展开变成城市天际线的扁平插画，莫兰迪色高级感" },
      { f: "social-quote-card.webp", label: "金句卡片", enLabel: "Quote card", brief: "做一张方形金句卡片，文字「慢慢来比较快」，米色纸纹背景配红色印章点缀" },
      { f: "social-podcast.webp", label: "播客封面", enLabel: "Podcast art", brief: "做一张播客封面，节目名 NIGHT TALKS，复古麦克风插画，Art Deco 风格" },
    ],
  },
  {
    key: "PPT 设计", en: "PRESENTATION",
    items: [
      { f: "ppt-cover.webp", label: "战略规划封面", enLabel: "Deck cover", brief: "做一张商务 PPT 封面，标题「2026 年度战略规划」，深蓝底发光数据线条，专业大气" },
      { f: "ppt-data.webp", label: "数据可视化页", enLabel: "Data slide", brief: "做一张 PPT 数据页背景，深色底上发光的 3D 图表和数据标注，现代分析风" },
      { f: "ppt-section.webp", label: "章节过渡页", enLabel: "Section divider", brief: "做一张 PPT 章节页，超大数字 03 配标题「市场分析」，右半建筑摄影分屏布局" },
      { f: "ppt-team.webp", label: "团队介绍页", enLabel: "Team slide", brief: "做一张 PPT 团队介绍页，四个圆形头像位带姓名职位标签，干净网格布局" },
    ],
  },
  {
    key: "Logo 设计", en: "LOGO & BRAND",
    items: [
      { f: "logo-minimal.webp", label: "极简线条", enLabel: "Minimal mark", brief: "为精品咖啡品牌 Mori Coffee 设计极简线条 logo，黑色细线条咖啡杯图形，奶油色底" },
      { f: "logo-badge.webp", label: "复古徽章", enLabel: "Vintage badge", brief: "为咖啡品牌 Mori Coffee 设计复古圆形徽章 logo，咖啡植物手绘线稿，墨绿底奶油线条" },
      { f: "logo-wordmark.webp", label: "几何字标", enLabel: "Wordmark", brief: "为咖啡品牌设计 MORI 字标 logo，几何粗体字形，字母 O 里藏咖啡豆负空间" },
      { f: "logo-tech.webp", label: "科技图形标", enLabel: "Tech mark", brief: "为科技初创公司设计抽象六边形交织线条 logo，青色到紫色渐变，深色底" },
      { f: "logo-restaurant.webp", label: "中式餐饮", enLabel: "Restaurant emblem", brief: "为中餐厅设计圆形徽章 logo，蒸汽碗筷图形中央一个「膳」字，朱红配金色" },
      { f: "logo-fitness.webp", label: "运动品牌", enLabel: "Fitness mark", brief: "为健身品牌设计动感 logo，速度笔触构成的奔跑人形，荧光绿配炭黑" },
    ],
  },
];

const ALL_CASES = (() => {
  const lists = CATEGORIES.map((c) => c.items.map((it) => ({ ...it, category: c.key, categoryEn: c.en })));
  const merged = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) {
    for (const l of lists) if (l[i]) merged.push(l[i]);
  }
  return merged;
})();

const MARQUEE_A = [
  "poster-vintage.webp", "ec-promo-poster.webp", "social-rednote.webp", "logo-badge.webp",
  "ec-sneaker-hero.webp", "social-youtube.webp", "ppt-cover.webp", "ec-skincare-scene.webp",
  "social-podcast.webp", "logo-tech.webp", "ec-banner-coffee.webp", "poster-night.webp",
];

const MARQUEE_B = [
  "ec-thermos-scene.webp", "social-bilibili.webp", "logo-restaurant.webp", "ec-food-poster.webp",
  "ppt-section.webp", "social-quote-card.webp", "ec-lipstick-luxury.webp", "logo-fitness.webp",
  "social-douyin.webp", "ec-watch-detail.webp", "ppt-data.webp", "poster-badge.webp",
];

/* ---------- 工具 ---------- */

function useReveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll(".reveal"));
    if (!els.length) return;
    const reveal = (el) => el.classList.add("reveal-visible");

    // 手动可视判断：兜底 IntersectionObserver（某些环境视口高度异常时 IO 不触发，
    // 会导致 .reveal 永远停在 opacity:0 → 首页整片黑屏）。
    const vh = () => window.innerHeight || document.documentElement.clientHeight || 800;
    const check = () => {
      let pending = false;
      for (const el of els) {
        if (el.classList.contains("reveal-visible")) continue;
        if (el.getBoundingClientRect().top < vh() * 0.92) reveal(el);
        else pending = true;
      }
      return pending;
    };

    let io;
    if (typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(
        (entries) => entries.forEach((e) => e.isIntersecting && reveal(e.target)),
        { threshold: 0, rootMargin: "0px 0px -8% 0px" }
      );
      els.forEach((el) => io.observe(el));
    }
    check(); // 首屏立即显示已在视口内的
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check, { passive: true });
    // 最终兜底：1.5s 后强制显示全部，杜绝任何情况下的永久隐形
    const fallback = setTimeout(() => els.forEach(reveal), 1500);

    return () => {
      io && io.disconnect();
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
      clearTimeout(fallback);
    };
  }, []);
}

function spotlightMove(e) {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
}

function ScrollProgress() {
  const [w, setW] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setW(max > 0 ? (window.scrollY / max) * 100 : 0);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return <div className="scroll-progress" style={{ width: `${w}%` }} />;
}

function CountUp({ to, duration = 1200 }) {
  const ref = useRef(null);
  const [val, setVal] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      obs.disconnect();
      const t0 = performance.now();
      const tick = (t) => {
        const p = Math.min(1, (t - t0) / duration);
        setVal(Math.round(to * (1 - Math.pow(1 - p, 3))));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, { threshold: 0.5 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [to, duration]);
  return <span ref={ref}>{val}</span>;
}

function RotatingPhrase() {
  const { lang } = useLang();
  const t = COPY[lang].hero;
  const list = ROTATING[lang];
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setIdx((i) => (i + 1) % list.length), 2600);
    return () => clearInterval(timer);
  }, [list.length]);
  const [subject, artifact] = list[idx];
  return (
    <span key={`${lang}-${idx}`} className="word-swap">
      {lang === "zh" ? (
        <>
          {t.forText}<span className="text-white font-semibold">{subject}</span>{t.designText}
          <span className="text-white font-semibold">{artifact}</span>
        </>
      ) : (
        <>
          {t.forText}<span className="text-white font-semibold">{artifact}</span>{t.designText}
          <span className="text-white font-semibold">{subject}</span>
        </>
      )}
    </span>
  );
}

function PlanDemo() {
  const { lang } = useLang();
  const t = COPY[lang].plan;
  const [step, setStep] = useState(2);
  useEffect(() => {
    const timer = setInterval(() => setStep((s) => (s + 1) % (t.steps.length + 2)), 1400);
    return () => clearInterval(timer);
  }, [t.steps.length]);
  return (
    <div className="bg-bg-card border border-white/10 rounded-sm p-6 shadow-[0_0_50px_rgba(0,0,0,0.5)] spotlight" onMouseMove={spotlightMove}>
      <div className="flex items-center justify-between mb-5">
        <span className="micro-label">{t.header}</span>
        <span className="text-[10px] font-mono text-gray-500">{t.meta}</span>
      </div>
      <div className="flex flex-col gap-3">
        {t.steps.map((s, i) => {
          const state = i < step ? "done" : i === step ? "active" : "pending";
          return (
            <div key={s.label} className={`flex items-center gap-3 px-3 py-2.5 rounded-sm border transition-all duration-500 ${
              state === "active" ? "border-white/30 bg-white/[0.04]" : "border-white/[0.06]"
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full transition-colors duration-500 ${
                state === "done" ? "bg-white" : state === "active" ? "bg-white animate-pulse" : "bg-gray-700"
              }`} />
              <span className={`text-[13px] font-semibold transition-colors duration-500 ${state === "pending" ? "text-gray-600" : "text-white"}`}>
                {state === "done" ? "✓ " : ""}{s.label}
              </span>
              <span className="text-[11px] text-gray-500 ml-auto">{s.detail}</span>
            </div>
          );
        })}
      </div>
      <div className="flex gap-2 mt-5">
        <div className={`flex-1 py-2 rounded-sm text-[11px] font-bold text-center uppercase tracking-wider transition-all duration-500 ${
          step >= 3 ? "bg-white text-black" : "border border-white/10 text-gray-500"
        }`}>
          {step >= t.steps.length ? t.executing : t.approve}
        </div>
        <div className="px-4 py-2 rounded-sm border border-white/10 text-gray-500 text-[11px] text-center uppercase tracking-wider">{t.cancel}</div>
      </div>
    </div>
  );
}

function BeforeAfter({ before, after, beforeLabel, afterLabel }) {
  const [pct, setPct] = useState(50);
  const ref = useRef(null);
  const onMove = (clientX) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setPct(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)));
  };
  return (
    <div
      ref={ref}
      className="relative rounded-sm border border-white/10 overflow-hidden select-none cursor-ew-resize shadow-[0_20px_40px_-10px_rgba(0,0,0,0.7)]"
      onPointerMove={(e) => e.buttons === 1 && onMove(e.clientX)}
      onPointerDown={(e) => onMove(e.clientX)}
    >
      <img src={after} alt={afterLabel} className="w-full block pointer-events-none" />
      <div className="absolute inset-0 pointer-events-none" style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }}>
        <img src={before} alt={beforeLabel} className="w-full block" />
      </div>
      <div className="absolute top-0 bottom-0 w-[2px] bg-white shadow-[0_0_12px_rgba(255,255,255,0.6)] pointer-events-none" style={{ left: `${pct}%` }}>
        <span className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-white text-black flex items-center justify-center text-[11px] font-bold">⇄</span>
      </div>
      <span className="absolute bottom-2 left-2 px-2 py-1 bg-black/70 micro-label pointer-events-none">{beforeLabel}</span>
      <span className="absolute bottom-2 right-2 px-2 py-1 bg-black/70 micro-label pointer-events-none">{afterLabel}</span>
    </div>
  );
}

function CaseCard({ item, index }) {
  const { lang } = useLang();
  const t = COPY[lang].cases;
  const label = lang === "zh" ? item.label : item.enLabel;
  const categoryLabel = lang === "zh" ? item.category : item.categoryEn;
  const copyBrief = (e) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard?.writeText(item.brief).then(
      () => toast.success(t.copied),
      () => toast.error(t.copyFail)
    );
  };
  return (
    <figure
      className="group relative mb-4 break-inside-avoid rounded-md overflow-hidden border border-white/[0.07] hover:border-white/25 transition-all duration-500 word-swap"
      style={{ animationDelay: `${Math.min(index * 0.04, 0.4)}s` }}
    >
      <img src={`/showcase/${item.f}`} alt={label} loading="lazy"
        className="w-full block group-hover:scale-[1.03] transition-transform duration-700" />
      <span className="absolute top-2 left-2 px-2 py-0.5 bg-black/65 backdrop-blur-sm text-gray-300 rounded-sm text-[9px] font-mono font-bold uppercase tracking-wider pointer-events-none">
        {categoryLabel}
      </span>
      {item.badge && (
        <span className="absolute top-2 right-2 px-2 py-0.5 bg-white text-black rounded-sm text-[9px] font-bold uppercase tracking-wider">
          {lang === "zh" ? "改图" : "EDIT"}
        </span>
      )}
      <figcaption className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-3 gap-2">
        <div>
          <span className="micro-label">// {categoryLabel}</span>
          <span className="block text-white text-[13px] font-bold mt-0.5">{label}</span>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={copyBrief}
            className="flex-1 py-1.5 rounded-sm bg-white/15 backdrop-blur-sm border border-white/25 text-white text-[10px] font-bold uppercase tracking-wider hover:bg-white/25 transition-all"
          >
            {t.copyPrompt}
          </button>
          <Link
            href={`/dashboard?q=${encodeURIComponent(item.brief)}`}
            className="flex-1 py-1.5 rounded-sm bg-white text-black text-[10px] font-bold uppercase tracking-wider text-center hover:bg-gray-200 transition-all"
          >
            {t.remake}
          </Link>
        </div>
      </figcaption>
    </figure>
  );
}

function UnifiedWall() {
  const { lang } = useLang();
  const t = COPY[lang].cases;
  const [filter, setFilter] = useState("ALL");
  const items = filter === "ALL" ? ALL_CASES : ALL_CASES.filter((c) => c.category === filter);
  return (
    <>
      <div className="flex justify-center gap-2 pb-8 flex-wrap px-4">
        {[["ALL", t.all], ...CATEGORIES.map((c) => [c.key, lang === "zh" ? c.key : c.en])].map(([value, display]) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            className={`px-5 py-2 rounded-sm text-[11px] font-bold uppercase tracking-[0.15em] border transition-all ${
              filter === value
                ? "bg-white text-black border-white"
                : "bg-white/5 text-gray-500 border-white/10 hover:border-white/25 hover:text-white"
            }`}
          >
            {display}
          </button>
        ))}
      </div>
      <div key={`${filter}-${lang}`} className="max-w-[1320px] mx-auto px-4 sm:px-6 columns-2 sm:columns-3 lg:columns-4 xl:columns-5 gap-4">
        {items.map((item, i) => (
          <CaseCard key={item.f} item={item} index={i} />
        ))}
      </div>
    </>
  );
}

/* ---------- 页面 ---------- */

export default function Landing() {
  useReveal();
  const { lang } = useLang();
  const t = COPY[lang];

  return (
    <div className="min-h-dvh bg-bg-page text-primary-text">
      <ScrollProgress />

      {/* Nav */}
      <header className="fixed top-0 left-0 right-0 z-[100] flex items-center justify-between px-6 sm:px-10 py-4 bg-[#09090b]/90 backdrop-blur-xl border-b border-white/[0.06]">
        <span className="flex items-center gap-2.5">
          <PicsmithMark size={22} className="text-white" />
          <span className="font-display text-xl font-extrabold tracking-tighter brand-gradient-text">Picsmith</span>
          <span className="micro-label hidden md:inline">{t.tagline}</span>
        </span>
        <nav className="flex items-center gap-5">
          <a href="#cases" className="text-[11px] font-mono uppercase tracking-[0.15em] text-gray-500 hover:text-white transition-colors hidden sm:inline">{t.nav.cases}</a>
          <a href="#pricing" className="text-[11px] font-mono uppercase tracking-[0.15em] text-gray-500 hover:text-white transition-colors hidden sm:inline">{t.nav.pricing}</a>
          <a href="#faq" className="text-[11px] font-mono uppercase tracking-[0.15em] text-gray-500 hover:text-white transition-colors hidden sm:inline">{t.nav.faq}</a>
          <LangSwitch className="hidden sm:inline-flex" />
          <Link href="/dashboard" className="px-5 py-2 bg-white text-black rounded-sm text-[10px] font-bold uppercase tracking-[0.15em] hover:bg-gray-200 transition-all shadow-[0_0_20px_rgba(255,255,255,0.1)]">
            {t.nav.enter}
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative grid-bg-animated pt-36 pb-16 overflow-hidden">
        <div className="absolute top-[8%] left-1/2 -translate-x-1/2 w-[44rem] h-[44rem] bg-white/[0.035] rounded-full blur-[150px] pointer-events-none" />
        <div className="relative max-w-4xl mx-auto text-center flex flex-col items-center gap-6 px-6">
          <div className="micro-label hero-in hero-in-1">{t.hero.kicker}</div>
          <h1 className="font-display text-4xl sm:text-6xl font-extrabold tracking-tight leading-tight hero-in hero-in-2">
            {t.hero.title1}<span className="shimmer">{t.hero.title2}</span>
          </h1>
          <p className="text-base sm:text-xl text-secondary-text hero-in hero-in-3">
            <RotatingPhrase />
            {t.hero.sub}
          </p>
          <div className="flex items-center gap-4 mt-2 hero-in hero-in-4">
            <Link href="/dashboard" className="px-8 py-3 bg-white text-black rounded-sm text-[12px] font-bold uppercase tracking-[0.15em] hover:bg-gray-200 hover:scale-[1.03] transition-all shadow-[0_0_30px_rgba(255,255,255,0.15)]">
              {t.hero.cta}
            </Link>
            <a href="#how" className="px-6 py-3 rounded-sm text-[12px] font-bold uppercase tracking-[0.15em] border border-white/10 bg-white/5 text-gray-400 hover:border-white/20 hover:text-white transition-all">
              {t.hero.how}
            </a>
          </div>
          <div className="micro-label hero-in hero-in-5">{t.hero.grant}</div>
        </div>

        {/* 双行反向无限画廊 */}
        <div className="marquee mt-14 hero-in hero-in-5">
          <div className="marquee-track">
            {[...MARQUEE_A, ...MARQUEE_A].map((f, i) => (
              <div key={i} className="h-44 rounded-sm border border-white/10 overflow-hidden shadow-[0_20px_40px_-10px_rgba(0,0,0,0.7)] hover:border-white/30 transition-all shrink-0">
                <img src={`/showcase/${f}`} alt="Picsmith showcase" className="h-full w-auto object-cover" loading="lazy" />
              </div>
            ))}
          </div>
        </div>
        <div className="marquee mt-4 hero-in hero-in-5">
          <div className="marquee-track marquee-track-reverse">
            {[...MARQUEE_B, ...MARQUEE_B].map((f, i) => (
              <div key={i} className="h-44 rounded-sm border border-white/10 overflow-hidden shadow-[0_20px_40px_-10px_rgba(0,0,0,0.7)] hover:border-white/30 transition-all shrink-0">
                <img src={`/showcase/${f}`} alt="Picsmith showcase" className="h-full w-auto object-cover" loading="lazy" />
              </div>
            ))}
          </div>
        </div>
        <div className="micro-label text-center mt-5">{t.hero.marqueeNote}</div>
      </section>

      {/* Agent 流程演示 */}
      <section id="how" className="py-24 px-6 border-t border-white/[0.06]">
        <div className="max-w-5xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
          <div className="flex flex-col gap-5 reveal">
            <div className="micro-label">{t.how.kicker}</div>
            <h2 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight">
              {t.how.title1}<br />{t.how.title2}<span className="brand-gradient-text">{t.how.title3}</span>
            </h2>
            <p className="text-secondary-text leading-relaxed">{t.how.p1}</p>
            <p className="text-secondary-text leading-relaxed">{t.how.p2}</p>
          </div>
          <div className="reveal reveal-d1">
            <PlanDemo />
          </div>
        </div>
      </section>

      {/* 案例库：统一大墙 */}
      <section id="cases" className="py-24 border-t border-white/[0.06]">
        <div className="text-center flex flex-col gap-4 reveal px-6">
          <div className="micro-label">{t.cases.kicker}</div>
          <h2 className="font-display text-3xl sm:text-5xl font-extrabold tracking-tight">
            {t.cases.title1}<span className="brand-gradient-text">{t.cases.title2}</span>
          </h2>
          <p className="text-secondary-text">{t.cases.sub}</p>
        </div>

        <div className="flex justify-center gap-10 py-10 micro-label reveal">
          <span><span className="text-white text-lg font-data"><CountUp to={ALL_CASES.length} /></span>&nbsp;{t.cases.statCases}</span>
          <span><span className="text-white text-lg font-data"><CountUp to={CATEGORIES.length} /></span>&nbsp;{t.cases.statScenes}</span>
          <span><span className="text-white text-lg font-data">0</span>&nbsp;{t.cases.statRetouch}</span>
        </div>

        <UnifiedWall />
      </section>

      {/* 改图对比 */}
      <section className="py-24 px-6 border-t border-white/[0.06]">
        <div className="max-w-5xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
          <div className="flex flex-col gap-5 reveal order-2 lg:order-1">
            <div className="micro-label">{t.edit.kicker}</div>
            <h2 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight">
              {t.edit.title1}<span className="brand-gradient-text">{t.edit.title2}</span>
            </h2>
            <p className="text-secondary-text leading-relaxed">{t.edit.p1}</p>
            <p className="text-secondary-text leading-relaxed">{t.edit.p2}</p>
          </div>
          <div className="reveal reveal-d1 order-1 lg:order-2 max-w-sm mx-auto w-full">
            <BeforeAfter before="/showcase/poster-vintage.webp" after="/showcase/poster-night.webp"
              beforeLabel={t.edit.before} afterLabel={t.edit.after} />
          </div>
        </div>
      </section>

      {/* 功能矩阵 */}
      <section className="py-24 px-6 border-t border-white/[0.06]">
        <div className="max-w-5xl mx-auto flex flex-col gap-12">
          <div className="text-center flex flex-col gap-4 reveal">
            <div className="micro-label">{t.features.kicker}</div>
            <h2 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight">{t.features.title}</h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-6">
            {t.features.list.map((f, i) => (
              <div key={f.tag} onMouseMove={spotlightMove}
                className={`spotlight reveal reveal-d${i % 2 ? 1 : 0} bg-bg-card border border-white/[0.08] rounded-sm p-7 hover:border-white/20 hover:-translate-y-1 transition-all duration-500 shadow-[0_0_50px_rgba(0,0,0,0.5)]`}>
                <div className="micro-label mb-4">// {f.tag}</div>
                <h3 className="text-lg font-bold text-white mb-2">{f.title}</h3>
                <p className="text-[13px] text-secondary-text leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 定价（与计费页一致：免费 + 三档积分包） */}
      <section id="pricing" className="py-24 px-6 border-t border-white/[0.06]">
        <div className="max-w-5xl mx-auto flex flex-col gap-12">
          <div className="text-center flex flex-col gap-4 reveal">
            <div className="micro-label">{t.pricing.kicker}</div>
            <h2 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight">{t.pricing.title}</h2>
            <p className="micro-label">{t.pricing.freeNote}</p>
          </div>
          <div className="grid sm:grid-cols-3 gap-5 max-w-3xl mx-auto w-full">
            {t.pricing.packs.map((p, i) => (
              <div key={p.id} onMouseMove={spotlightMove}
                className={`spotlight reveal reveal-d${i} bg-bg-card border border-white/[0.08] rounded-sm p-7 flex flex-col gap-3 hover:border-white/20 transition-all`}>
                <div className="micro-label">{p.label}</div>
                <div className="font-data text-3xl">{p.credits}<span className="text-sm text-gray-500 ml-1 font-normal">credits</span></div>
                <div className="text-secondary-text text-[13px]">{p.price}</div>
                <Link href="/register"
                  className="mt-2 py-2.5 bg-white text-black rounded-sm text-[11px] font-bold text-center uppercase tracking-[0.15em] hover:bg-gray-200 transition-all">
                  {t.pricing.buy}
                </Link>
              </div>
            ))}
          </div>
          <div className="text-center reveal">
            <Link href="/register" className="micro-label hover:text-white transition-colors">→ {t.pricing.startFree}</Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-24 px-6 border-t border-white/[0.06]">
        <div className="max-w-3xl mx-auto flex flex-col gap-10">
          <div className="text-center flex flex-col gap-4 reveal">
            <div className="micro-label">{t.faq.kicker}</div>
            <h2 className="font-display text-3xl font-extrabold tracking-tight">{t.faq.title}</h2>
          </div>
          <div className="flex flex-col gap-4">
            {t.faq.list.map(([q, a], i) => (
              <details key={q} className={`reveal reveal-d${i % 3} bg-bg-card border border-white/[0.08] rounded-sm px-6 py-4 group`}>
                <summary className="text-[14px] font-semibold text-white cursor-pointer list-none flex justify-between items-center">
                  {q}
                  <span className="text-gray-600 group-open:rotate-45 transition-transform">+</span>
                </summary>
                <p className="text-[13px] text-secondary-text leading-relaxed mt-3">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* 底部 CTA */}
      <section className="py-28 px-6 border-t border-white/[0.06] grid-bg-animated">
        <div className="max-w-3xl mx-auto text-center flex flex-col items-center gap-6 reveal">
          <PicsmithMark size={44} className="text-white" />
          <h2 className="font-display text-3xl sm:text-5xl font-extrabold tracking-tight">
            {t.cta.title1}<span className="shimmer">{t.cta.title2}</span>
          </h2>
          <Link href="/dashboard" className="px-10 py-4 bg-white text-black rounded-sm text-[13px] font-bold uppercase tracking-[0.15em] hover:bg-gray-200 hover:scale-[1.03] transition-all shadow-[0_0_30px_rgba(255,255,255,0.15)]">
            {t.cta.button}
          </Link>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
