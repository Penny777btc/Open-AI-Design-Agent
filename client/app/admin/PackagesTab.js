"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import {
  ADMIN,
  adminGet,
  adminPost,
  errMsg,
  sudoConfig,
  useSudo,
  Overlay,
  cardCls,
  inputCls,
  btnGhost,
  btnPrimary,
  btnDanger,
  Badge,
  Th,
  fmtMoney,
} from "./ui";

// 价格用「元」录入，提交时 ×100 转回 amount_cents（后端存分）。
function PackageModal({ pkg, onClose, onSaved }) {
  const { run } = useSudo();
  const editing = !!pkg;
  const [slug, setSlug] = useState(pkg?.slug || "");
  const [label, setLabel] = useState(pkg?.label || "");
  const [credits, setCredits] = useState(pkg?.credits ?? "");
  const [dollars, setDollars] = useState(pkg ? (pkg.amount_cents / 100).toFixed(2) : "");
  const [sortOrder, setSortOrder] = useState(pkg?.sort_order ?? 0);
  const [busy, setBusy] = useState(false);

  const cents = Math.round(Number(dollars) * 100);
  const valid =
    (editing || /^[a-z0-9_-]{2,48}$/.test(slug)) &&
    label.trim().length >= 1 &&
    Number(credits) >= 1 &&
    Number.isFinite(cents) &&
    cents >= 0;

  const submit = async () => {
    setBusy(true);
    try {
      const res = await run((pw) => {
        if (editing) {
          return axios.patch(
            `${ADMIN}/packages/${pkg.id}`,
            { label: label.trim(), credits: Number(credits), amount_cents: cents, sort_order: Number(sortOrder) },
            sudoConfig(pw)
          );
        }
        return axios.post(
          `${ADMIN}/packages`,
          {
            slug: slug.trim(),
            label: label.trim(),
            credits: Number(credits),
            amount_cents: cents,
            currency: "usd",
            type: "one_time",
            sort_order: Number(sortOrder),
          },
          sudoConfig(pw)
        );
      });
      if (!res) return; // sudo 取消
      toast.success(editing ? "已保存" : "套餐已创建");
      onSaved();
      onClose();
    } catch (err) {
      toast.error(errMsg(err, "保存失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay onClose={onClose}>
      <div className="micro-label">// {editing ? "编辑套餐" : "新建套餐"}</div>
      <div className="flex flex-col gap-3">
        {!editing && (
          <div>
            <div className="micro-label mb-1.5">标识 slug（小写字母数字 _- ，2-48）</div>
            <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="例如 starter" className={inputCls} />
          </div>
        )}
        <div>
          <div className="micro-label mb-1.5">名称</div>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="例如 Starter Pack" className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="micro-label mb-1.5">积分</div>
            <input type="number" value={credits} onChange={(e) => setCredits(e.target.value)} className={inputCls} />
          </div>
          <div>
            <div className="micro-label mb-1.5">价格（美元）</div>
            <input type="number" step="0.01" value={dollars} onChange={(e) => setDollars(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="micro-label mb-1.5">排序（小在前）</div>
            <input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className={inputCls} />
          </div>
          <div>
            <div className="micro-label mb-1.5">类型</div>
            <div className="px-4 py-2.5 bg-white/[0.02] border border-white/10 rounded-sm text-gray-500 font-mono text-sm">
              一次性（订阅待开放）
            </div>
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-3 mt-1">
        <button onClick={onClose} className={btnGhost}>取消</button>
        <button onClick={submit} disabled={!valid || busy} className={btnPrimary}>
          {busy ? "保存中…" : "保存"}
        </button>
      </div>
    </Overlay>
  );
}

export default function PackagesTab({ readOnly }) {
  const { run } = useSudo();
  const [rows, setRows] = useState([]);
  const [inited, setInited] = useState(false);
  const [editFor, setEditFor] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await adminGet("/packages");
      setRows(data);
    } catch (err) {
      toast.error(errMsg(err, "加载套餐失败"));
    } finally {
      setInited(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleActive = async (pkg) => {
    try {
      if (pkg.active) {
        const res = await run((pw) => axios.delete(`${ADMIN}/packages/${pkg.id}`, sudoConfig(pw)));
        if (!res) return;
        toast.success("已下架");
      } else {
        const res = await run((pw) => axios.patch(`${ADMIN}/packages/${pkg.id}`, { active: true }, sudoConfig(pw)));
        if (!res) return;
        toast.success("已上架");
      }
      load();
    } catch (err) {
      toast.error(errMsg(err, "操作失败"));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {!readOnly && (
        <div className="flex justify-end">
          <button onClick={() => setCreating(true)} className={btnPrimary}>新建套餐</button>
        </div>
      )}

      <div className={`${cardCls} overflow-hidden`}>
        <table className="w-full text-[12px]">
          <thead className="border-b border-white/[0.08]">
            <tr>
              <Th>名称</Th>
              <Th>标识</Th>
              <Th>积分</Th>
              <Th>价格</Th>
              <Th>排序</Th>
              <Th>状态</Th>
              <Th className="text-right">操作</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.05]">
            {rows.map((p) => (
              <tr key={p.id} className="hover:bg-white/[0.02]">
                <td className="px-4 py-3 text-gray-200">{p.label}</td>
                <td className="px-4 py-3 text-gray-600 font-mono text-[11px]">{p.slug}</td>
                <td className="px-4 py-3 font-data text-gray-300">{p.credits}</td>
                <td className="px-4 py-3 font-data text-white">{fmtMoney(p.amount_cents, p.currency)}</td>
                <td className="px-4 py-3 font-data text-gray-500">{p.sort_order}</td>
                <td className="px-4 py-3">
                  <Badge tone={p.active ? "paid" : "muted"}>{p.active ? "上架" : "已下架"}</Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    {readOnly ? (
                      <span className="text-gray-700 font-mono text-[11px]">—</span>
                    ) : (
                      <>
                        <button className={btnGhost} onClick={() => setEditFor(p)}>编辑</button>
                        <button className={p.active ? btnDanger : btnGhost} onClick={() => toggleActive(p)}>
                          {p.active ? "下架" : "上架"}
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {inited && rows.length === 0 ? (
          <div className="px-5 py-8 text-center text-[13px] text-gray-600">暂无套餐</div>
        ) : null}
      </div>

      {creating ? <PackageModal onClose={() => setCreating(false)} onSaved={load} /> : null}
      {editFor ? <PackageModal pkg={editFor} onClose={() => setEditFor(null)} onSaved={load} /> : null}
    </div>
  );
}
