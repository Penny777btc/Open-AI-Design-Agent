"use client";
import React from "react";
import { FiBox, FiArrowRight, FiZap } from "react-icons/fi";

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
    if (layer.length === 0) break; // cycle or missing dep
    layers.push(layer);
    layer.forEach(n => processed.add(n.id));
    remaining = remaining.filter(n => !processed.has(n.id));
  }

  return (
    <div className="mt-3 mb-3 p-4 rounded-xl border border-divider shadow-float bg-bg-page/60 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-primary-text flex items-center gap-1.5">
            <FiZap size={13} className="text-primary" /> 即将为你制作
          </h3>
          <p className="text-[12px] text-secondary-strong mt-0.5 truncate">{plan.title}</p>
        </div>
        <div className="text-right shrink-0 ml-3">
          <div className="text-[13px] font-semibold text-primary-text">
            {plan.total_credits} <span className="text-[11px] text-secondary-text font-normal">积分</span>
          </div>
          <div className="text-[11px] text-secondary-strong">{plan.nodes.length} 步</div>
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
                  className="w-44 p-3 rounded-lg bg-bg-card border border-divider hover:border-primary/40 transition-colors relative z-10"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[12px] font-medium text-primary-text leading-snug">
                      {node.label || "处理中"}
                    </span>
                    <span className="text-[10px] font-semibold text-secondary-strong bg-bg-page px-1.5 py-0.5 rounded shrink-0">
                      {node.est_credits || 0}
                    </span>
                  </div>
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
