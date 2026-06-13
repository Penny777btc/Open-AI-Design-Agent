"use client";

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { adminGet, errMsg, cardCls, Badge, LoadMore, Th, fmtDate } from "./ui";

const PAGE = 100;

const ACTION_CN = {
  adjust_credits: "调整积分",
  ban: "封禁",
  unban: "解封",
};
const ACTION_TONE = {
  adjust_credits: "muted",
  ban: "banned",
  unban: "ok",
};

export default function AuditTab() {
  const [rows, setRows] = useState([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [inited, setInited] = useState(false);

  const load = useCallback(async (reset) => {
    setLoading(true);
    const off = reset ? 0 : offset;
    try {
      const { data } = await adminGet(`/audit-logs?limit=${PAGE}&offset=${off}`);
      setRows((prev) => (reset ? data : [...prev, ...data]));
      setOffset(off + data.length);
      setDone(data.length < PAGE);
    } catch (err) {
      toast.error(errMsg(err, "加载审计日志失败"));
    } finally {
      setLoading(false);
      setInited(true);
    }
  }, [offset]);

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderDetail = (d) => {
    if (d == null) return "—";
    if (typeof d === "string") return d;
    try {
      return JSON.stringify(d);
    } catch {
      return String(d);
    }
  };

  return (
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
  );
}
