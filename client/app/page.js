"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PicsmithMark } from "@/components/Logo";

/* Picsmith（图匠）落地页
   结构参考 Lovart 首页，视觉为 Tectonic Industrial 体系。
   所有案例素材均为产品真实生成（client/public/showcase/）。 */

const ROTATING = [
  ["咖啡品牌", "小红书封面"],
  ["保温杯新品", "电商主图"],
  ["手冲咖啡店", "Logo 方案"],
  ["露营装备", "促销海报"],
];

/* 顶部无限画廊（混排三大场景） */
const MARQUEE = [
  "poster-vintage.png", "ec-promo-poster.png", "social-rednote.png", "logo-badge.png",
  "ec-thermos-hero.png", "social-youtube.png", "poster-badge.png", "ec-skincare-scene.png",
  "social-podcast.png", "logo-minimal.png", "ec-banner-coffee.png", "poster-night.png",
];

const SCENES = [
  {
    key: "ecom",
    label: "电商设计",
    tag: "E-COMMERCE",
    desc: "主图、场景图、促销海报、详情 banner —— 从上架到大促的全套视觉。",
    items: [
      ["ec-thermos-hero.png", "白底主图 · 直接可上架"],
      ["ec-skincare-scene.png", "场景化主图 · 氛围种草"],
      ["ec-promo-poster.png", "大促海报 · 中文文字精准渲染"],
      ["ec-banner-coffee.png", "详情页 banner · 16:9"],
    ],
  },
  {
    key: "logo",
    label: "Logo 设计",
    tag: "LOGO & BRAND",
    desc: "一个 brief，多个方向：极简标记、复古徽章、字标——一次对比，挑你最爱。",
    items: [
      ["logo-minimal.png", "方案 A · 极简线条"],
      ["logo-badge.png", "方案 B · 复古徽章"],
      ["logo-wordmark.png", "方案 C · 几何字标"],
    ],
  },
  {
    key: "social",
    label: "自媒体配图",
    tag: "SOCIAL MEDIA",
    desc: "小红书封面、视频缩略图、播客封面——大字标题渲染稳定，点击率说话。",
    items: [
      ["social-rednote.png", "小红书封面 · 中文大字"],
      ["social-youtube.png", "视频缩略图 · 高点击率构图"],
      ["social-podcast.png", "播客封面 · 复古风"],
    ],
  },
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
  { tag: "VERTICAL", title: "为三个场景深度打磨", desc: "电商主图与详情页、品牌 Logo、自媒体封面海报。垂直场景的提示词工程与模板，比通用工具更懂你的活。" },
];

const FAQS = [
  ["生成一张图要多久？", "海报类图片通常 35-75 秒，复杂编辑约 2-3 分钟。任务卡片会显示预估耗时，全程可以离开页面，回来自动恢复进度。"],
  ["积分怎么计算？", "按生成消耗：每张图 10 credits 起，编辑类按复杂度略高。注册即送 500 credits，执行前的计划阶段不收费。"],
  ["生成的图片版权归谁？", "归你。生成结果可自由用于商业用途，我们不会将你的素材用于任何其他目的。"],
  ["和 Midjourney / 即梦有什么区别？", "它们是「生成器」，Picsmith 是「设计 Agent」——理解完整需求、规划多资产交付、支持反复修改迭代，产出的是能直接上架/发布的成套设计，不是单张图。"],
];

/* ---------- 小组件 ---------- */

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

/* 自动循环推进的计划卡片演示 */
function PlanDemo() {
  const [step, setStep] = useState(2);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => (s + 1) % (PLAN_STEPS.length + 2)), 1400);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="bg-bg-card border border-white/10 rounded-sm p-6 shadow-[0_0_50px_rgba(0,0,0,0.5)]">
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

/* 改图前后对比滑块 */
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

/* ---------- 页面 ---------- */

export default function Landing() {
  useReveal();
  const [scene, setScene] = useState("ecom");
  const active = SCENES.find((s) => s.key === scene);

  return (
    <div className="min-h-dvh bg-bg-page text-primary-text">
      {/* Nav */}
      <header className="fixed top-0 left-0 right-0 z-[100] flex items-center justify-between px-6 sm:px-10 py-4 bg-[#09090b]/90 backdrop-blur-xl border-b border-white/[0.06]">
        <span className="flex items-center gap-2.5">
          <PicsmithMark size={22} className="text-white" />
          <span className="font-display text-xl font-extrabold tracking-tighter brand-gradient-text">Picsmith</span>
          <span className="micro-label hidden md:inline">图匠 // E-COM · LOGO · SOCIAL</span>
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
      <section className="relative grid-bg-animated pt-36 pb-16 px-6 overflow-hidden">
        <div className="absolute top-[8%] left-1/2 -translate-x-1/2 w-[44rem] h-[44rem] bg-white/[0.035] rounded-full blur-[150px] pointer-events-none" />
        <div className="relative max-w-4xl mx-auto text-center flex flex-col items-center gap-6">
          <div className="micro-label hero-in hero-in-1">PICSMITH · 图匠 · AI DESIGN AGENT</div>
          <h1 className="font-display text-4xl sm:text-6xl font-extrabold tracking-tight leading-tight hero-in hero-in-2">
            从一句话，到<span className="brand-gradient-text">成套设计</span>
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
          <div className="micro-label hero-in hero-in-5">注册即送 500 CREDITS · 无需信用卡</div>
        </div>

        {/* 无限滚动画廊 */}
        <div className="marquee mt-14 hero-in hero-in-5">
          <div className="marquee-track">
            {[...MARQUEE, ...MARQUEE].map((f, i) => (
              <div key={i} className="h-52 rounded-sm border border-white/10 overflow-hidden shadow-[0_20px_40px_-10px_rgba(0,0,0,0.7)] hover:border-white/30 transition-all shrink-0">
                <img src={`/showcase/${f}`} alt="Picsmith generated showcase" className="h-full w-auto object-cover" loading="lazy" />
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

      {/* 案例：按场景分区 */}
      <section id="cases" className="py-24 px-6 border-t border-white/[0.06]">
        <div className="max-w-5xl mx-auto flex flex-col gap-10">
          <div className="text-center flex flex-col gap-4 reveal">
            <div className="micro-label">// REAL OUTPUT</div>
            <h2 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight">三个场景，真实产出</h2>
            <p className="text-secondary-text">以下每一张都来自 Picsmith 的真实生成记录，所见即所得。</p>
          </div>
          <div className="flex justify-center gap-2 reveal">
            {SCENES.map((s) => (
              <button
                key={s.key}
                onClick={() => setScene(s.key)}
                className={`px-5 py-2 rounded-sm text-[11px] font-bold uppercase tracking-[0.15em] border transition-all ${
                  scene === s.key
                    ? "bg-white text-black border-white"
                    : "bg-white/5 text-gray-500 border-white/10 hover:border-white/25 hover:text-white"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div key={scene} className="flex flex-col gap-6">
            <div className="text-center">
              <span className="micro-label">// {active.tag}</span>
              <p className="text-secondary-text text-[13px] mt-2">{active.desc}</p>
            </div>
            <div className={`grid gap-5 ${active.items.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-4"}`}>
              {active.items.map(([f, label], i) => (
                <figure key={f} className={`flex flex-col gap-2 word-swap`} style={{ animationDelay: `${i * 0.08}s` }}>
                  <div className="rounded-sm border border-white/10 overflow-hidden shadow-[0_20px_40px_-10px_rgba(0,0,0,0.7)] hover:border-white/30 hover:-translate-y-1 transition-all duration-500 bg-bg-card aspect-square">
                    <img src={`/showcase/${f}`} alt={label} className="w-full h-full object-cover" loading="lazy" />
                  </div>
                  <figcaption className="micro-label text-center">{label}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        </div>
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
            <BeforeAfter before="/showcase/poster-vintage.png" after="/showcase/poster-night.png" />
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
              <div key={f.tag} className={`reveal reveal-d${i % 2 ? 1 : 0} bg-bg-card border border-white/[0.08] rounded-sm p-7 hover:border-white/20 hover:-translate-y-1 transition-all duration-500 shadow-[0_0_50px_rgba(0,0,0,0.5)]`}>
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
            <div className="reveal bg-bg-card border border-white/[0.08] rounded-sm p-8 flex flex-col gap-4">
              <div className="micro-label">STARTER</div>
              <div className="font-display text-4xl font-extrabold">免费</div>
              <ul className="text-[13px] text-secondary-text flex flex-col gap-2 flex-1">
                <li>✓ 注册即送 500 credits</li>
                <li>✓ 全部生成与改图能力</li>
                <li>✓ 无限画布与项目管理</li>
              </ul>
              <Link href="/dashboard" className="py-2.5 bg-white text-black rounded-sm text-[11px] font-bold text-center uppercase tracking-[0.15em] hover:bg-gray-200 transition-all">
                免费开始
              </Link>
            </div>
            <div className="reveal reveal-d1 bg-bg-card border border-white/[0.08] rounded-sm p-8 flex flex-col gap-4 opacity-70">
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
            全速创作，<span className="brand-gradient-text">让愿景成真</span>
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
            <span className="micro-label">图匠 · E-COM · LOGO · SOCIAL</span>
          </span>
          <div className="flex items-center gap-6 micro-label">
            <a href="#cases" className="hover:text-white transition-colors">案例</a>
            <a href="#pricing" className="hover:text-white transition-colors">定价</a>
            <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
            <span>© 2026 PICSMITH</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
