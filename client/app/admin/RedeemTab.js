"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import {
  ADMIN,
  adminGet,
  errMsg,
  sudoConfig,
  useSudo,
  Overlay,
  CsvButton,
  Chip,
  cardCls,
  inputCls,
  btnGhost,
  btnPrimary,
  Badge,
  LoadMore,
  Th,
  fmtDate,
} from "./ui";

const PAGE = 100;

const STATUS_TABS = [
  { key: "all", label: "全部" },
  { key: "active", label: "未使用" },
  { key: "redeemed", label: "已使用" },
  { key: "disabled", label: "已停用" },
];

// 批量生成弹层：数量 / 面额 / 批次 / 有效期（sudo）。成功后展示码列表，可复制+导出。
function GenerateModal({ onClose, onGenerated }) {
  const { run } = useSudo();
  const [count, setCount] = useState(10);
  const [credits, setCredits] = useState(1000);
  const [batch, setBatch] = useState("");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { batch, count, codes }

  const valid = Number(count) >= 1 && Number(count) <= 1000 && Number(credits) >= 1;

  const submit = async () => {
    setBusy(true);
    try {
      const body = { count: Number(count), credits: Number(credits) };
      if (batch.trim()) body.batch = batch.trim();
      if (expires) body.expires_at = new Date(expires + "T23:59:59").toISOString();
      const res = await run((pw) => axios.post(`${ADMIN}/redeem-codes`, body, sudoConfig(pw)));
      if (!res) return;
      setResult(res.data);
      onGenerated();
    } catch (err) {
      toast.error(errMsg(err, "生成失败"));
    } finally {
      setBusy(false);
    }
  };

  const copyAll = () => {
    navigator.clipboard.writeText((result?.codes || []).join("\n"));
    toast.success(`已复制 ${result.codes.length} 个兑换码`);
  };

  const exportCodes = () => {
    const csv = "兑换码\r\n" + (result?.codes || []).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `redeem-${result.batch}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (result) {
    return (
      <Overlay onClose={onClose}>
        <div className="micro-label text-emerald-400">// 已生成 {result.count} 个兑换码 · 批次 {result.batch}</div>
        <p className="text-[12px] text-gray-400">请立即复制或导出——关闭后需到列表逐个查看。</p>
        <div className="max-h-60 overflow-y-auto border border-white/[0.08] rounded-sm p-3 font-mono text-[11px] text-gray-300 leading-relaxed">
          {result.codes.map((c) => (
            <div key={c}>{c}</div>
          ))}
        </div>
        <div className="flex justify-end gap-3 mt-1">
          <button onClick={exportCodes} className={btnGhost}>导出 CSV</button>
          <button onClick={copyAll} className={btnGhost}>复制全部</button>
          <button onClick={onClose} className={btnPrimary}>完成</button>
        </div>
      </Overlay>
    );
  }

  return (
    <Overlay onClose={onClose}>
      <div className="micro-label">// 批量生成兑换码</div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="micro-label mb-1.5">数量（1-1000）</div>
          <input type="number" value={count} onChange={(e) => setCount(e.target.value)} className={inputCls} />
        </div>
        <div>
          <div className="micro-label mb-1.5">每张面额（积分）</div>
          <input type="number" value={credits} onChange={(e) => setCredits(e.target.value)} className={inputCls} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="micro-label mb-1.5">批次名（可选）</div>
          <input value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="如 launch-2026" className={inputCls} />
        </div>
        <div>
          <div className="micro-label mb-1.5">有效期（可选）</div>
          <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} className={inputCls} />
        </div>
      </div>
      <div className="flex justify-end gap-3 mt-1">
        <button onClick={onClose} className={btnGhost}>取消</button>
        <button onClick={submit} disabled={!valid || busy} className={btnPrimary}>
          {busy ? "生成中…" : "生成"}
        </button>
      </div>
    </Overlay>
  );
}

export default function RedeemTab({ readOnly }) {
  const { run } = useSudo();
  const [status, setStatus] = useState("all");
  const [rows, setRows] = useState([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [inited, setInited] = useState(false);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(
    async (reset) => {
      setLoading(true);
      const off = reset ? 0 : offset;
      try {
        const { data } = await adminGet(`/redeem-codes?status=${status}&limit=${PAGE}&offset=${off}`);
        setRows((prev) => (reset ? data : [...prev, ...data]));
        setOffset(off + data.length);
        setDone(data.length < PAGE);
      } catch (err) {
        toast.error(errMsg(err, "加载兑换码失败"));
      } finally {
        setLoading(false);
        setInited(true);
      }
    },
    [offset, status]
  );

  useEffect(() => {
    setRows([]);
    setOffset(0);
    setDone(false);
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const disable = async (rc) => {
    try {
      const res = await run((pw) => axios.post(`${ADMIN}/redeem-codes/${rc.id}/disable`, {}, sudoConfig(pw)));
      if (!res) return;
      toast.success("已停用");
      setRows((prev) => prev.map((c) => (c.id === rc.id ? { ...c, status: "disabled" } : c)));
    } catch (err) {
      toast.error(errMsg(err, "停用失败"));
    }
  };

  const csvCols = [
    { key: "code", label: "兑换码" },
    { key: "credits", label: "面额" },
    { key: "batch", label: "批次" },
    { key: "status", label: "状态" },
    { label: "兑换时间", get: (c) => c.redeemed_at || "" },
    { label: "创建时间", get: (c) => c.created_at || "" },
  ];

  const tone = (s) => (s === "active" ? "paid" : s === "redeemed" ? "admin" : "muted");
  const statusZh = { active: "未使用", redeemed: "已使用", disabled: "已停用" };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-2">
          {STATUS_TABS.map((s) => (
            <Chip key={s.key} active={status === s.key} onClick={() => setStatus(s.key)}>
              {s.label}
            </Chip>
          ))}
        </div>
        <div className="flex gap-2">
          <CsvButton filename="redeem-codes" columns={csvCols} rows={rows} />
          {!readOnly && (
            <button onClick={() => setGenerating(true)} className={btnPrimary}>批量生成</button>
          )}
        </div>
      </div>

      <div className={`${cardCls} overflow-hidden`}>
        <table className="w-full text-[12px]">
          <thead className="border-b border-white/[0.08]">
            <tr>
              <Th>兑换码</Th>
              <Th>面额</Th>
              <Th>批次</Th>
              <Th>状态</Th>
              <Th>兑换时间</Th>
              <Th>创建时间</Th>
              <Th className="text-right">操作</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.05]">
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-white/[0.02]">
                <td className="px-4 py-3 font-mono text-gray-200 text-[11px]">{c.code}</td>
                <td className="px-4 py-3 font-data text-white">{c.credits}</td>
                <td className="px-4 py-3 text-gray-600 font-mono text-[11px]">{c.batch || "—"}</td>
                <td className="px-4 py-3"><Badge tone={tone(c.status)}>{statusZh[c.status] || c.status}</Badge></td>
                <td className="px-4 py-3 text-gray-600 font-mono text-[11px]">{c.redeemed_at ? fmtDate(c.redeemed_at) : "—"}</td>
                <td className="px-4 py-3 text-gray-600 font-mono text-[11px]">{fmtDate(c.created_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end">
                    {!readOnly && c.status === "active" ? (
                      <button className={btnGhost} onClick={() => disable(c)}>停用</button>
                    ) : (
                      <span className="text-gray-700 font-mono text-[11px]">—</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <LoadMore
          onClick={() => load(false)}
          loading={loading}
          done={done && rows.length > 0}
          empty={inited && rows.length === 0}
          emptyText="暂无兑换码"
        />
      </div>

      {generating ? <GenerateModal onClose={() => setGenerating(false)} onGenerated={() => load(true)} /> : null}
    </div>
  );
}
