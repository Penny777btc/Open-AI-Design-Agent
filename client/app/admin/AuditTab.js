"use client";

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  adminGet,
  errMsg,
  cardCls,
  inputCls,
  CsvButton,
  Badge,
  LoadMore,
  Th,
  fmtDate,
} from "./ui";

const PAGE = 100;

const ACTION_CN = {
  adjust_credits: "调整积分",
  ban: "封禁",
  unban: "解封",
  set_quota: "调整配额",
  takedown_asset: "内容下架",
  refund_order: "订单退款",
};
const ACTION_TONE = {
  adjust_credits: "muted",
  ban: "banned",
  unban: "ok",
  set_quota: "muted",
  takedown_asset: "banned",
  refund_order: "fail",
};

// 下拉筛选选项（与后端 action 参数一致）。
const ACTION_OPTIONS = [
  { value: "", label: "全部动作" },
  { value: "adjust_credits", label: "调整积分" },
  { value: "ban", label: "封禁" },
  { value: "unban", label: "解封" },
  { value: "set_quota", label: "调整配额" },
  { value: "takedown_asset", label: "内容下架" },
  { value: "refund_order", label: "订单退款" },
];

const renderDetail = (d) => {
  if (d == null) return "—";
  if (typeof d === "string") return d;
  try {
    return JSON.stringify(d);
  } catch {
    return String(d);
  }
};

export default function AuditTab() {
  const [rows, setRows] = useState([]);
  const [action, setAction] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [inited, setInited] = useState(false);

  const load = useCallback(
    async (reset) => {
      setLoading(true);
      const off = reset ? 0 : offset;
      try {
        const actionQ = action ? `&action=${encodeURIComponent(action)}` : "";
        const { data } = await adminGet(`/audit-logs?limit=${PAGE}&offset=${off}${actionQ}`);
        setRows((prev) => (reset ? data : [...prev, ...data]));
        setOffset(off + data.length);
        setDone(data.length < PAGE);
      } catch (err) {
        toast.error(errMsg(err, "加载审计日志失败"));
      } finally {
        setLoading(false);
        setInited(true);
      }
    },
    [offset, action]
  );

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  const csvCols = [
    { label: "时间", get: (r) => r.created_at || "" },
    { key: "admin_email", label: "管理员" },
    { label: "动作", get: (r) => ACTION_CN[r.action] || r.action },
    { label: "对象", get: (r) => r.target_user_id || "" },
    { label: "详情", get: (r) => renderDetail(r.detail) },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <select
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className={`${inputCls} w-auto pr-8`}
        >
          {ACTION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value} className="bg-bg-card text-white">
              {o.label}
            </option>
          ))}
        </select>
        <CsvButton filename="audit-logs" columns={csvCols} rows={rows} />
      </div>

      <div className={`${cardCls} overflow-hidden`}>
        <table className="w-full text-[12px]">
          <thead className="border-b border-white/[0.08]">
            <tr>
              <Th className="w-44">时间</Th>
              <Th>管理员</Th>
              <Th>动作</Th>
              <Th>对象</Th>
              <Th>详情</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.05]">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-white/[0.02] align-top">
                <td className="px-4 py-3 text-gray-600 font-mono text-[11px] whitespace-nowrap">{fmtDate(r.created_at)}</td>
                <td className="px-4 py-3 text-gray-300">{r.admin_email}</td>
                <td className="px-4 py-3">
                  <Badge tone={ACTION_TONE[r.action] || "muted"}>{ACTION_CN[r.action] || r.action}</Badge>
                </td>
                <td className="px-4 py-3 text-gray-500 font-mono text-[11px] break-all">{r.target_user_id || "—"}</td>
                <td className="px-4 py-3 text-gray-500 font-mono text-[11px] break-all max-w-md">{renderDetail(r.detail)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <LoadMore
          onClick={() => load(false)}
          loading={loading}
          done={done && rows.length > 0}
          empty={inited && rows.length === 0}
          emptyText="暂无审计日志"
        />
      </div>
    </div>
  );
}
