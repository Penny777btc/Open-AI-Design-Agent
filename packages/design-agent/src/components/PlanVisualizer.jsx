"use client";
import React from "react";
import { FiBox, FiArrowRight, FiZap } from "react-icons/fi";
import { t } from "../i18n";

/**
 * Renders a DAG (Directed Acyclic Graph) of plan nodes.
 * Groups nodes by their topological layers for a clean horizontal flow.
 */
export default function PlanVisualizer({ plan, theme = "dark" }) {
  if (!plan || !plan.nodes) return null;

  // Simple topological grouping by dependencies
  const layers = [];
  const processed = new Set();
  let remaining = [...plan.nodes];

  while (remaining.length > 0) {
    const layer = remaining.filter(n =>
      !n.depends || n.depends.length === 0 || n.depends.every(d => processed.has(d))
    );
    if (layer.length === 0) {
      // M8：依赖成环 / 依赖指向不存在的节点 → 拓扑排不动。旧逻辑直接 break，
      // 把剩余节点静默丢掉 → 头部「X 步」与实际渲染的节点数对不上、用户看到的图缺步。
      // 兜底：把剩余节点整体作为最后一层渲染（标「依赖异常」），保证节点不丢、步数吻合。
      layers.push(remaining.map(n => ({ ...n, _depAnomaly: true })));
      remaining = [];
      break;
    }
    layers.push(layer);
    layer.forEach(n => processed.add(n.id));
    remaining = remaining.filter(n => !processed.has(n.id));
  }

  // 节点序号表：把 depends 里的内部 id（node_1…）翻译成用户能懂的「第 N 步」
  const stepNoById = new Map(plan.nodes.map((n, i) => [n.id, i + 1]));

  // 逐条一句话描述。why：落地页承诺「做哪几张、每张什么构图」，但计划卡此前只有
  // 「X 积分 / X 步」——卖点在产品内根本看不见。label 说"做什么"，这行再补"怎么做"：
  // 工具类型人话 + 画幅/时长 + 衔接哪一步。args 目前后端不外发（plan_propose 只带
  // id/tool/label/est_credits/depends），这里做了向前兼容：后端一旦附上 args
  // （aspect_ratio/seconds/prompt），描述自动变具体，前端无需再改。
  const nodeDesc = (node) => {
    const a = node.args || {};
    const parts = [];
    const key = `plan_tool_${node.tool}`;
    const toolText = t(key);
    // t() 未命中会原样返回 key —— 未知工具回落到通用文案，不把内部 key 曝给用户
    parts.push(toolText === key ? t("plan_tool_default") : toolText);
    if (a.aspect_ratio) parts.push(a.aspect_ratio);
    if (a.seconds) parts.push(t("plan_seconds_unit", a.seconds));
    if (node.depends && node.depends.length > 0) {
      const steps = node.depends.map((d) => stepNoById.get(d)).filter(Boolean).join(",");
      if (steps) parts.push(t("plan_after_steps", steps));
    }
    return parts.join(" · ");
  };

  return (
    <div className="mt-3 mb-3 p-4 rounded-xl border border-divider shadow-float bg-bg-page/60 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-primary-text flex items-center gap-1.5">
            <FiZap size={13} className="text-primary" /> {t("plan_about_to_make")}
          </h3>
          <p className="text-[12px] text-secondary-strong mt-0.5 truncate">{plan.title}</p>
        </div>
        <div className="text-right shrink-0 ml-3">
          <div className="text-[13px] font-semibold text-primary-text">
            {/* L3：总消耗未知（后端没给数字）时显示「—」，而非留白或误导性的 0/undefined */}
            {typeof plan.total_credits === "number" ? plan.total_credits : "—"} <span className="text-[11px] text-secondary-strong font-normal">{t("credits_unit")}</span>
          </div>
          <div className="text-[11px] text-secondary-strong">{t("steps_unit", plan.nodes.length)}</div>
        </div>
      </div>

      <div className="relative overflow-x-auto scrollbar-subtle pb-1">
        <div className="flex items-stretch gap-8 min-w-max px-1">
          {layers.map((layer, lIdx) => (
            <div key={lIdx} className="flex flex-col gap-3 justify-center">
              {layer.map((node) => (
                <div
                  key={node.id}
                  id={`plan-node-${node.id}`}
                  className="w-48 p-3 rounded-lg bg-bg-card border border-divider hover:border-primary/40 transition-colors relative z-10"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[12px] font-medium text-primary-text leading-snug">
                      {/* 步骤序号：desc 里的「衔接第 N 步」需要一个可对照的锚点 */}
                      <span className="text-secondary-strong font-semibold mr-1">{stepNoById.get(node.id)}.</span>
                      {node.label || t("node_processing")}
                      {/* M8：依赖异常兜底渲染的节点显式标注，避免用户误以为顺序正常 */}
                      {node._depAnomaly && (
                        <span className="ml-1.5 text-[9px] font-semibold text-[var(--color-error)] bg-[var(--color-error-bg)] px-1 py-0.5 rounded">{t("plan_dep_anomaly")}</span>
                      )}
                    </span>
                    <span className="text-[10px] font-semibold text-secondary-strong bg-bg-page px-1.5 py-0.5 rounded shrink-0">
                      {/* L3：单步消耗未知时显示「—」而非 0 */}
                      {typeof node.est_credits === "number" ? node.est_credits : "—"}
                    </span>
                  </div>
                  {/* 逐条预览：这一步的性质（新绘/改图/视频）+ 画幅时长 + 依赖关系 */}
                  <div className="text-[10px] text-secondary-strong mt-1 leading-relaxed">
                    {nodeDesc(node)}
                  </div>
                  {/* 后端若附带构图提示词，截断展示、悬停看全文（当前不外发，向前兼容） */}
                  {node.args?.prompt && (
                    <div className="text-[10px] text-secondary-strong/80 mt-1 truncate" title={node.args.prompt}>
                      {node.args.prompt}
                    </div>
                  )}
                  {lIdx < layers.length - 1 && (
                    <div className="absolute top-1/2 -right-8 w-8 h-px bg-gradient-to-r from-divider to-transparent" />
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {plan.notes && plan.notes.length > 0 && (
        <div className="mt-3 pt-3 border-t border-divider/60">
          {plan.notes.map((note, i) => (
            <div key={i} className="text-[11px] text-secondary-strong flex items-start gap-2 leading-relaxed">
              <span className="w-1 h-1 rounded-full bg-primary mt-1.5 shrink-0" /> {note}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
