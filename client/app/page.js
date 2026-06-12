"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { PicsmithMark } from "@/components/Logo";

/* Picsmith（图匠）落地页
   结构参考 Lovart，视觉为 Tectonic Industrial 体系。
   案例全部来自产品真实生成（client/public/showcase/），
   每个案例可复制提示词或一键“做同款”（带 brief 跳转工作台）。 */

const ROTATING = [
  ["咖啡品牌", "小红书封面"],
  ["保温杯新品", "电商主图"],
  ["年度汇报", "PPT 封面"],
  ["手冲咖啡店", "Logo 方案"],
  ["露营装备", "促销海报"],
];

/* 按品类分区的案例库：brief 即「做同款」的工作台输入 */
const CATEGORIES = [
  {
    key: "电商设计",
    en: "E-COMMERCE",
    desc: "主图、场景图、促销海报、详情 banner——从上架到大促的全套视觉。",
    items: [
      { f: "ec-thermos-hero.webp", label: "白底主图", brief: "为不锈钢保温杯生成一张白底电商主图，影棚级打光，可直接上架" },
      { f: "ec-sneaker-hero.webp", label: "运动鞋主图", brief: "为白橙配色跑鞋生成一张悬浮角度的白底电商主图，动感构图" },
      { f: "ec-thermos-scene.webp", label: "户外场景图", badge: "改图", brief: "把这张白底保温杯主图改成黄金时刻的露营溪流场景，产品保持完全一致" },
      { f: "ec-skincare-scene.webp", label: "场景化主图", brief: "为琥珀色精华液瓶生成一张晨光石板上的场景化主图，氛围种草感" },
      { f: "ec-lipstick-luxury.webp", label: "美妆大片", brief: "为玫瑰金口红生成一张黑丝绸背景的奢华美妆广告图，戏剧性打光" },
      { f: "ec-promo-poster.webp", label: "大促海报", brief: "做一张竖版电商大促海报，标题「年中大促」副标题「全场5折起」，红金配色喜庆氛围" },
      { f: "ec-food-poster.webp", label: "外卖海报", brief: "做一张竖版美食外卖海报，标题「新店开业」副标题「第二份半价」，汉堡奶茶诱人摄影" },
      { f: "ec-watch-detail.webp", label: "细节大片", brief: "为机械腕表生成一张微距细节横幅，侧光突出表盘质感，暗调背景" },
      { f: "ec-banner-coffee.webp", label: "详情 Banner", brief: "为精品咖啡豆做一张 16:9 详情页头图，牛皮纸袋和咖啡豆，暖棕色调" },
    ],
  },
  {
    key: "自媒体配图",
    en: "SOCIAL MEDIA",
    desc: "小红书封面、视频缩略图、公众号头图——大字标题渲染稳定，点击率说话。",
    items: [
      { f: "social-rednote.webp", label: "小红书封面", brief: "做一张小红书封面，标题「7天收纳改造计划」，明亮治愈的家居整理风格" },
      { f: "social-bilibili.webp", label: "B站封面", brief: "做一张 16:9 视频封面，超大标题「3分钟看懂AI」，蓝白科技感高对比构图" },
      { f: "social-douyin.webp", label: "竖版知识封面", brief: "做一张竖版短视频知识封面，标题「早起的5个习惯」，日出渐变背景元气风" },
      { f: "social-youtube.webp", label: "YouTube 缩略图", brief: "做一张 YouTube 缩略图，文字 AI TOOLS 2026，人物指向发光手机，高点击率构图" },
      { f: "social-wechat-banner.webp", label: "公众号头图", brief: "做一张公众号头图，书本展开变成城市天际线的扁平插画，莫兰迪色高级感" },
      { f: "social-quote-card.webp", label: "金句卡片", brief: "做一张方形金句卡片，文字「慢慢来比较快」，米色纸纹背景配红色印章点缀" },
      { f: "social-podcast.webp", label: "播客封面", brief: "做一张播客封面，节目名 NIGHT TALKS，复古麦克风插画，Art Deco 风格" },
    ],
  },
  {
    key: "PPT 设计",
    en: "PRESENTATION",
    desc: "封面、数据页、章节页、团队页——让整个 deck 有咨询公司级的质感。",
    items: [
      { f: "ppt-cover.webp", label: "战略规划封面", brief: "做一张商务 PPT 封面，标题「2026 年度战略规划」，深蓝底发光数据线条，专业大气" },
      { f: "ppt-data.webp", label: "数据可视化页", brief: "做一张 PPT 数据页背景，深色底上发光的 3D 图表和数据标注，现代分析风" },
      { f: "ppt-section.webp", label: "章节过渡页", brief: "做一张 PPT 章节页，超大数字 03 配标题「市场分析」，右半建筑摄影分屏布局" },
      { f: "ppt-team.webp", label: "团队介绍页", brief: "做一张 PPT 团队介绍页，四个圆形头像位带姓名职位标签，干净网格布局" },
    ],
  },
  {
    key: "Logo 设计",
    en: "LOGO & BRAND",
    desc: "一个 brief 多个方向：极简、徽章、字标、图形标——对比着挑，不用反复沟通。",
    items: [
      { f: "logo-minimal.webp", label: "极简线条", brief: "为精品咖啡品牌 Mori Coffee 设计极简线条 logo，黑色细线条咖啡杯图形，奶油色底" },
      { f: "logo-badge.webp", label: "复古徽章", brief: "为咖啡品牌 Mori Coffee 设计复古圆形徽章 logo，咖啡植物手绘线稿，墨绿底奶油线条" },
      { f: "logo-wordmark.webp", label: "几何字标", brief: "为咖啡品牌设计 MORI 字标 logo，几何粗体字形，字母 O 里藏咖啡豆负空间" },
      { f: "logo-tech.webp", label: "科技图形标", brief: "为科技初创公司设计抽象六边形交织线条 logo，青色到紫色渐变，深色底" },
      { f: "logo-restaurant.webp", label: "中式餐饮", brief: "为中餐厅设计圆形徽章 logo，蒸汽碗筷图形中央一个「膳」字，朱红配金色" },
      { f: "logo-fitness.webp", label: "运动品牌", brief: "为健身品牌设计动感 logo，速度笔触构成的奔跑人形，荧光绿配炭黑" },
    ],
  },
];

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

const PLAN_STEPS = [
  { label: "理解需求", detail: "拆解 brief → 资产清单" },
  { label: "生成计划", detail: "2 个节点 · 预估 20 credits" },
  { label: "等待批准", detail: "确认后才消耗积分" },
  { label: "并行出图", detail: "自动排布到画布" },
];

const FEATURES = [
  { tag: "PLAN FIRST", title: "计划先行，消耗可控", desc: "出图前先给你完整执行计划和积分预估，批准才执行。不烧无意义的额度，每一分消耗都在你掌控里。" },
  { tag: "ITERATE", title: "对话改图，构图不丢", desc: "「把这张改成夜间冷色调」——文字、构图、细节原样保留，只改你说的部分。设计是迭代出来的，不是抽卡抽出来的。" },
  { tag: "INFINITE CANVAS", title: "无限画布工作区", desc: "生成结果自动按行排布，编辑版本自动放在原图旁边。刷新页面布局原样恢复，项目资产一目了然。" },
  { tag: "VERTICAL", title: "为四个场景深度打磨", desc: "电商视觉、自媒体配图、PPT 设计、品牌 Logo。垂直场景的提示词工程与模板，比通用工具更懂你的活。" },
];

const FAQS = [
  ["生成一张图要多久？", "海报类图片通常 35-75 秒，复杂编辑约 2-3 分钟。任务卡片会显示预估耗时，全程可以离开页面，回来自动恢复进度。"],
  ["积分怎么计算？", "按生成消耗：每张图 10 credits 起，编辑类按复杂度略高。注册即送 200 credits，执行前的计划阶段不收费。"],
  ["生成的图片版权归谁？", "归你。生成结果可自由用于商业用途，我们不会将你的素材用于任何其他目的。"],
  ["和 Midjourney / 即梦有什么区别？", "它们是「生成器」，Picsmith 是「设计 Agent」——理解完整需求、规划多资产交付、支持反复修改迭代，产出的是能直接上架/发布的成套设计，不是单张图。"],
];

/* ---------- 工具 ---------- */

function useReveal() {
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add("reveal-visible")),
      { threshold: 0.12 }
    );
    document.querySelectorAll(".reveal").forEach((el) => obs.observe(el));
    return () => obs.disconnect();
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

/* 数字滚动（进入视口时计数） */
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
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % ROTATING.length), 2600);
    return () => clearInterval(t);
  }, []);
  return (
    <span key={idx} className="word-swap">
      为「<span className="text-white font-semibold">{ROTATING[idx][0]}</span>」设计
      <span className="text-white font-semibold">{ROTATING[idx][1]}</span>
    </span>
  );
}

function PlanDemo() {
  const [step, setStep] = useState(2);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => (s + 1) % (PLAN_STEPS.length + 2)), 1400);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="bg-bg-card border border-white/10 rounded-sm p-6 shadow-[0_0_50px_rgba(0,0,0,0.5)] spotlight" onMouseMove={spotlightMove}>
      <div className="flex items-center justify-between mb-5">
        <span className="micro-label">PROPOSED EXECUTION PLAN</span>
        <span className="text-[10px] font-mono text-gray-500">20 CREDITS · 2 STEPS</span>
      </div>
      <div className="flex flex-col gap-3">
        {PLAN_STEPS.map((s, i) => {
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
          {step >= PLAN_STEPS.length ? "✓ Executing…" : "Approve & Execute"}
        </div>
        <div className="px-4 py-2 rounded-sm border border-white/10 text-gray-500 text-[11px] text-center uppercase tracking-wider">Cancel</div>
      </div>
    </div>
  );
}

function BeforeAfter({ before, after, beforeLabel = "原始生成", afterLabel = "一句话改图后" }) {
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

/* 全部案例拍平 + 品类交错混排（统一大墙的视觉节奏） */
const ALL_CASES = (() => {
  const lists = CATEGORIES.map((c) => c.items.map((it) => ({ ...it, category: c.key })));
  const merged = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) {
    for (const l of lists) if (l[i]) merged.push(l[i]);
  }
  return merged;
})();

const FILTERS = ["全部", ...CATEGORIES.map((c) => c.key)];

/* 案例卡：常驻品类角标 + 悬停浮出「复制提示词 / 做同款」 */
function CaseCard({ item, category, index }) {
  const copyBrief = (e) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard?.writeText(item.brief).then(
      () => toast.success("提示词已复制，去工作台粘贴即可"),
      () => toast.error("复制失败")
    );
  };
  return (
    <figure
      className="group relative mb-4 break-inside-avoid rounded-md overflow-hidden border border-white/[0.07] hover:border-white/25 transition-all duration-500 word-swap"
      style={{ animationDelay: `${Math.min(index * 0.04, 0.4)}s` }}
    >
      <img src={`/showcase/${item.f}`} alt={item.label} loading="lazy"
        className="w-full block group-hover:scale-[1.03] transition-transform duration-700" />
      {/* 常驻品类角标：统一墙里也能一眼识别分类 */}
      <span className="absolute top-2 left-2 px-2 py-0.5 bg-black/65 backdrop-blur-sm text-gray-300 rounded-sm text-[9px] font-mono font-bold uppercase tracking-wider pointer-events-none">
        {item.category}
      </span>
      {item.badge && (
        <span className="absolute top-2 right-2 px-2 py-0.5 bg-white text-black rounded-sm text-[9px] font-bold uppercase tracking-wider">
          {item.badge}
        </span>
      )}
      <figcaption className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-3 gap-2">
        <div>
          <span className="micro-label">// {category}</span>
          <span className="block text-white text-[13px] font-bold mt-0.5">{item.label}</span>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={copyBrief}
            className="flex-1 py-1.5 rounded-sm bg-white/15 backdrop-blur-sm border border-white/25 text-white text-[10px] font-bold uppercase tracking-wider hover:bg-white/25 transition-all"
          >
            复制提示词
          </button>
          <Link
            href={`/dashboard?q=${encodeURIComponent(item.brief)}`}
            className="flex-1 py-1.5 rounded-sm bg-white text-black text-[10px] font-bold uppercase tracking-wider text-center hover:bg-gray-200 transition-all"
          >
            做同款 →
          </Link>
        </div>
      </figcaption>
    </figure>
  );
}

/* 统一案例墙：chips 筛选，无分段标题 */
function UnifiedWall() {
  const [filter, setFilter] = useState("全部");
  const items = filter === "全部" ? ALL_CASES : ALL_CASES.filter((c) => c.category === filter);
  return (
    <>
      <div className="flex justify-center gap-2 pb-8 flex-wrap px-4">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-5 py-2 rounded-sm text-[11px] font-bold uppercase tracking-[0.15em] border transition-all ${
              filter === f
                ? "bg-white text-black border-white"
                : "bg-white/5 text-gray-500 border-white/10 hover:border-white/25 hover:text-white"
            }`}
          >
            {f}
          </button>
        ))}
      </div>
      <div key={filter} className="max-w-[1320px] mx-auto px-4 sm:px-6 columns-2 sm:columns-3 lg:columns-4 xl:columns-5 gap-4">
        {items.map((item, i) => (
          <CaseCard key={item.f} item={item} category={item.category} index={i} />
        ))}
      </div>
    </>
  );
}

/* ---------- 页面 ---------- */

export default function Landing() {
  useReveal();
  const totalCases = CATEGORIES.reduce((n, c) => n + c.items.length, 0);

  return (
    <div className="min-h-dvh bg-bg-page text-primary-text">
      <ScrollProgress />

      {/* Nav */}
      <header className="fixed top-0 left-0 right-0 z-[100] flex items-center justify-between px-6 sm:px-10 py-4 bg-[#09090b]/90 backdrop-blur-xl border-b border-white/[0.06]">
        <span className="flex items-center gap-2.5">
          <PicsmithMark size={22} className="text-white" />
          <span className="font-display text-xl font-extrabold tracking-tighter brand-gradient-text">Picsmith</span>
          <span className="micro-label hidden md:inline">图匠 // E-COM · SOCIAL · PPT · LOGO</span>
        </span>
        <nav className="flex items-center gap-5">
          <a href="#cases" className="text-[11px] font-mono uppercase tracking-[0.15em] text-gray-500 hover:text-white transition-colors hidden sm:inline">案例</a>
          <a href="#pricing" className="text-[11px] font-mono uppercase tracking-[0.15em] text-gray-500 hover:text-white transition-colors hidden sm:inline">定价</a>
          <a href="#faq" className="text-[11px] font-mono uppercase tracking-[0.15em] text-gray-500 hover:text-white transition-colors hidden sm:inline">FAQ</a>
          <Link href="/dashboard" className="px-5 py-2 bg-white text-black rounded-sm text-[10px] font-bold uppercase tracking-[0.15em] hover:bg-gray-200 transition-all shadow-[0_0_20px_rgba(255,255,255,0.1)]">
            进入工作台
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative grid-bg-animated pt-36 pb-16 overflow-hidden">
        <div className="absolute top-[8%] left-1/2 -translate-x-1/2 w-[44rem] h-[44rem] bg-white/[0.035] rounded-full blur-[150px] pointer-events-none" />
        <div className="relative max-w-4xl mx-auto text-center flex flex-col items-center gap-6 px-6">
          <div className="micro-label hero-in hero-in-1">PICSMITH · 图匠 · AI DESIGN AGENT</div>
          <h1 className="font-display text-4xl sm:text-6xl font-extrabold tracking-tight leading-tight hero-in hero-in-2">
            从一句话，到<span className="shimmer">成套设计</span>
          </h1>
          <p className="text-base sm:text-xl text-secondary-text hero-in hero-in-3">
            <RotatingPhrase />
            —— 规划、生成、修改，一个 Agent 全包。
          </p>
          <div className="flex items-center gap-4 mt-2 hero-in hero-in-4">
            <Link href="/dashboard" className="px-8 py-3 bg-white text-black rounded-sm text-[12px] font-bold uppercase tracking-[0.15em] hover:bg-gray-200 hover:scale-[1.03] transition-all shadow-[0_0_30px_rgba(255,255,255,0.15)]">
              立即开始设计
            </Link>
            <a href="#how" className="px-6 py-3 rounded-sm text-[12px] font-bold uppercase tracking-[0.15em] border border-white/10 bg-white/5 text-gray-400 hover:border-white/20 hover:text-white transition-all">
              看看怎么工作
            </a>
          </div>
          <div className="micro-label hero-in hero-in-5">注册即送 200 CREDITS · 无需信用卡</div>
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
        <div className="micro-label text-center mt-5">↑ 全部由 PICSMITH 生成 · 未经人工修饰</div>
      </section>

      {/* Agent 流程演示 */}
      <section id="how" className="py-24 px-6 border-t border-white/[0.06]">
        <div className="max-w-5xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
          <div className="flex flex-col gap-5 reveal">
            <div className="micro-label">// HOW IT WORKS</div>
            <h2 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight">
              不是抽卡，<br />是<span className="brand-gradient-text">有计划的交付</span>
            </h2>
            <p className="text-secondary-text leading-relaxed">
              描述需求后，Agent 先产出完整执行计划——做哪几张、每张什么构图、总共花多少积分。
              你批准了它才动手，过程逐步可见，中途随时取消。
            </p>
            <p className="text-secondary-text leading-relaxed">
              这是设计 Agent 和「生成器」的本质区别：它对结果负责，而不是对单次生成负责。
            </p>
          </div>
          <div className="reveal reveal-d1">
            <PlanDemo />
          </div>
        </div>
      </section>

      {/* 案例库：按品类分区 */}
      <section id="cases" className="py-24 border-t border-white/[0.06]">
        <div className="text-center flex flex-col gap-4 reveal px-6">
          <div className="micro-label">// REAL OUTPUT · CLICK TO REMAKE</div>
          <h2 className="font-display text-3xl sm:text-5xl font-extrabold tracking-tight">
            四大场景，<span className="brand-gradient-text">拿来即用</span>
          </h2>
          <p className="text-secondary-text">每一张都来自真实生成记录。看中哪张——复制提示词，或直接「做同款」。</p>
        </div>

        {/* 统计条（滚动计数） */}
        <div className="flex justify-center gap-10 py-10 micro-label reveal">
          <span><span className="text-white text-lg font-data"><CountUp to={totalCases} /></span>&nbsp;真实案例</span>
          <span><span className="text-white text-lg font-data"><CountUp to={CATEGORIES.length} /></span>&nbsp;垂直场景</span>
          <span><span className="text-white text-lg font-data">0</span>&nbsp;人工修饰</span>
        </div>

        {/* 统一大墙：品类混排 + chips 筛选 + 卡片角标识别分类 */}
        <UnifiedWall />
      </section>

      {/* 改图对比（可拖动滑块） */}
      <section className="py-24 px-6 border-t border-white/[0.06]">
        <div className="max-w-5xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
          <div className="flex flex-col gap-5 reveal order-2 lg:order-1">
            <div className="micro-label">// ITERATE WITHOUT LOSING</div>
            <h2 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight">
              一句话改图，<span className="brand-gradient-text">细节不走样</span>
            </h2>
            <p className="text-secondary-text leading-relaxed">
              「把这张海报改成深蓝色冷色调的夜间版本，保留所有文字和构图」——
              拖动滑块看看：文字一字不差，构图分毫未动，只有氛围彻底改变。
            </p>
            <p className="text-secondary-text leading-relaxed">
              电商场景同理：白底主图一句话变户外场景图，产品保持完全一致。
            </p>
          </div>
          <div className="reveal reveal-d1 order-1 lg:order-2 max-w-sm mx-auto w-full">
            <BeforeAfter before="/showcase/poster-vintage.webp" after="/showcase/poster-night.webp" />
          </div>
        </div>
      </section>

      {/* 功能矩阵 */}
      <section className="py-24 px-6 border-t border-white/[0.06]">
        <div className="max-w-5xl mx-auto flex flex-col gap-12">
          <div className="text-center flex flex-col gap-4 reveal">
            <div className="micro-label">// CAPABILITIES</div>
            <h2 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight">设计，不止于生成</h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-6">
            {FEATURES.map((f, i) => (
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

      {/* 定价 */}
      <section id="pricing" className="py-24 px-6 border-t border-white/[0.06]">
        <div className="max-w-4xl mx-auto flex flex-col gap-12">
          <div className="text-center flex flex-col gap-4 reveal">
            <div className="micro-label">// PRICING</div>
            <h2 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight">先免费用起来</h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-6 max-w-2xl mx-auto w-full">
            <div onMouseMove={spotlightMove} className="spotlight reveal bg-bg-card border border-white/[0.08] rounded-sm p-8 flex flex-col gap-4">
              <div className="micro-label">STARTER</div>
              <div className="font-display text-4xl font-extrabold">免费</div>
              <ul className="text-[13px] text-secondary-text flex flex-col gap-2 flex-1">
                <li>✓ 注册即送 200 credits</li>
                <li>✓ 全部生成与改图能力</li>
                <li>✓ 无限画布与项目管理</li>
              </ul>
              <Link href="/dashboard" className="py-2.5 bg-white text-black rounded-sm text-[11px] font-bold text-center uppercase tracking-[0.15em] hover:bg-gray-200 transition-all">
                免费开始
              </Link>
            </div>
            <div onMouseMove={spotlightMove} className="spotlight reveal reveal-d1 bg-bg-card border border-white/[0.08] rounded-sm p-8 flex flex-col gap-4 opacity-70">
              <div className="micro-label">PRO</div>
              <div className="font-display text-4xl font-extrabold">即将上线</div>
              <ul className="text-[13px] text-secondary-text flex flex-col gap-2 flex-1">
                <li>· 大额积分包与订阅</li>
                <li>· 批量生成与品牌套件</li>
                <li>· 视频生成（模型就绪后）</li>
              </ul>
              <div className="py-2.5 border border-white/10 text-gray-500 rounded-sm text-[11px] font-bold text-center uppercase tracking-[0.15em]">Coming Soon</div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-24 px-6 border-t border-white/[0.06]">
        <div className="max-w-3xl mx-auto flex flex-col gap-10">
          <div className="text-center flex flex-col gap-4 reveal">
            <div className="micro-label">// FAQ</div>
            <h2 className="font-display text-3xl font-extrabold tracking-tight">常见问题</h2>
          </div>
          <div className="flex flex-col gap-4">
            {FAQS.map(([q, a], i) => (
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
            全速创作，<span className="shimmer">让愿景成真</span>
          </h2>
          <Link href="/dashboard" className="px-10 py-4 bg-white text-black rounded-sm text-[13px] font-bold uppercase tracking-[0.15em] hover:bg-gray-200 hover:scale-[1.03] transition-all shadow-[0_0_30px_rgba(255,255,255,0.15)]">
            免费开始
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.06] px-6 sm:px-10 py-10">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6">
          <span className="flex items-center gap-2.5">
            <PicsmithMark size={18} className="text-white" />
            <span className="font-display text-base font-extrabold tracking-tighter brand-gradient-text">Picsmith</span>
            <span className="micro-label">图匠 · E-COM · SOCIAL · PPT · LOGO</span>
          </span>
          <div className="flex items-center gap-5 micro-label flex-wrap justify-center">
            <a href="#cases" className="hover:text-white transition-colors">案例</a>
            <a href="#pricing" className="hover:text-white transition-colors">定价</a>
            <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
            <Link href="/legal/terms" className="hover:text-white transition-colors">服务条款</Link>
            <Link href="/legal/privacy" className="hover:text-white transition-colors">隐私政策</Link>
            <Link href="/legal/refund" className="hover:text-white transition-colors">退款政策</Link>
            <span>© 2026 PICSMITH</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
