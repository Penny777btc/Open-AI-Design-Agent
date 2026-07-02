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
  cardCls,
  btnGhost,
  btnPrimary,
  btnDanger,
  Badge,
  LoadMore,
  Th,
  fmtMoney,
  fmtDate,
} from "./ui";

const PAGE = 50;

// 退款确认弹层：写明金额与将扣回的积分数（sudo）。
function RefundModal({ order, onClose, onDone }) {
  const { run } = useSudo();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await run((pw) =>
        axios.post(`${ADMIN}/orders/${order.id}/refund`, {}, sudoConfig(pw))
      );
      if (!res) return; // 用户取消 sudo
      toast.success("已退款");
      onDone(order.id, res.data.status || "refunded");
      onClose();
    } catch (err) {
      // 503=未配置 Stripe / 400=非已支付，均按后端 detail 提示。
      toast.error(errMsg(err, "退款失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay onClose={onClose}>
      <div className="micro-label text-red-400">退款确认</div>
      <p className="text-[12px] text-gray-400 leading-relaxed">
        即将对订单 <span className="text-white font-mono">{order.user_email}</span> 整单退款：
      </p>
      <div className="border border-white/[0.08] rounded-sm divide-y divide-white/[0.06] text-[12px]">
        <div className="px-3 py-2 flex justify-between">
          <span className="text-gray-500">原路退回金额</span>
          <span className="font-data text-white">{fmtMoney(order.amount_cents, order.currency)}</span>
        </div>
        <div className="px-3 py-2 flex justify-between">
          <span className="text-gray-500">将从用户扣回积分</span>
          <span className="font-data text-red-400">-{order.credits}</span>
        </div>
      </div>
      <p className="text-[11px] text-gray-600 leading-relaxed">
        退款经 Stripe 原路退回，并从用户余额扣回赠送积分（允许扣成负数）。此操作不可撤销。
      </p>
      <div className="flex justify-end gap-3 mt-1">
        <button onClick={onClose} className={btnGhost}>取消</button>
        <button onClick={submit} disabled={busy} className={btnDanger}>
          {busy ? "退款中…" : "确认退款"}
        </button>
      </div>
    </Overlay>
  );
}

// 手动补单确认弹层：线下付款/回调丢失时人工入账（sudo）。
function MarkPaidModal({ order, onClose, onDone }) {
  const { run } = useSudo();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await run((pw) =>
        axios.post(`${ADMIN}/orders/${order.id}/mark-paid`, {}, sudoConfig(pw))
      );
      if (!res) return;
      toast.success("已标记为已付，积分已发放");
      onDone(order.id);
      onClose();
    } catch (err) {
      toast.error(errMsg(err, "操作失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay onClose={onClose}>
      <div className="micro-label">// 手动标记已付</div>
      <p className="text-[12px] text-gray-400 leading-relaxed">
        即将把 <span className="text-white font-mono">{order.user_email}</span> 的订单标记为已付，
        并向该用户发放 <span className="font-data text-emerald-400">{order.credits}</span> 积分。
      </p>
      <p className="text-[11px] text-gray-600 leading-relaxed">
        用于线下付款或支付回调丢失的人工入账。操作幂等，不会重复发放。
      </p>
      <div className="flex justify-end gap-3 mt-1">
        <button onClick={onClose} className={btnGhost}>取消</button>
        <button onClick={submit} disabled={busy} className={btnPrimary}>
          {busy ? "处理中…" : "确认入账"}
        </button>
      </div>
    </Overlay>
  );
}

export default function OrdersTab({ readOnly }) {
  const [rows, setRows] = useState([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [inited, setInited] = useState(false);
  // 三态补全：加载失败要留下可见的 error 态（toast 会消失，rows=[] 会被误读成「暂无订单」）
  const [error, setError] = useState(false);
  const [refundFor, setRefundFor] = useState(null);
  const [markFor, setMarkFor] = useState(null);

  const load = useCallback(async (reset) => {
    setLoading(true);
    setError(false); // 重试/翻页前清掉上次的错误态
    const off = reset ? 0 : offset;
    try {
      const { data } = await adminGet(`/orders?limit=${PAGE}&offset=${off}`);
      setRows((prev) => (reset ? data : [...prev, ...data]));
      setOffset(off + data.length);
      setDone(data.length < PAGE);
    } catch (err) {
      toast.error(errMsg(err, "加载订单失败"));
      setError(true);
    } finally {
      setLoading(false);
      setInited(true);
    }
  }, [offset]);

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const csvCols = [
    { key: "id", label: "订单ID" },
    { key: "user_email", label: "用户邮箱" },
    { label: "金额", get: (o) => fmtMoney(o.amount_cents, o.currency) },
    { key: "credits", label: "积分" },
    { key: "status", label: "状态" },
    { key: "provider", label: "渠道" },
    { label: "支付时间", get: (o) => o.paid_at || o.created_at || "" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <CsvButton filename="orders" columns={csvCols} rows={rows} />
      </div>

      <div className={`${cardCls} overflow-hidden`}>
        <table className="w-full text-[12px]">
          <thead className="border-b border-white/[0.08]">
            <tr>
              <Th>用户邮箱</Th>
              <Th>金额</Th>
              <Th>积分</Th>
              <Th>状态</Th>
              <Th>渠道</Th>
              <Th>支付时间</Th>
              <Th className="text-right">操作</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.05]">
            {rows.map((o) => (
              <tr key={o.id} className="hover:bg-white/[0.02]">
                <td className="px-4 py-3 text-gray-300">{o.user_email}</td>
                <td className="px-4 py-3 font-data text-white">{fmtMoney(o.amount_cents, o.currency)}</td>
                <td className="px-4 py-3 font-data text-gray-400">{o.credits}</td>
                <td className="px-4 py-3">
                  <Badge tone={o.status === "paid" ? "paid" : o.status === "refunded" ? "fail" : "muted"}>{o.status}</Badge>
                </td>
                <td className="px-4 py-3 text-gray-600 font-mono text-[11px]">{o.provider || "—"}</td>
                <td className="px-4 py-3 text-gray-600 font-mono text-[11px]">{fmtDate(o.paid_at || o.created_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    {!readOnly && o.status === "paid" ? (
                      <button className={btnDanger} onClick={() => setRefundFor(o)}>退款</button>
                    ) : !readOnly && o.status === "pending" ? (
                      <button className={btnPrimary} onClick={() => setMarkFor(o)}>标记已付</button>
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
          emptyText="暂无订单"
          error={error}
          errorText="加载订单失败"
        />
      </div>

      {refundFor ? (
        <RefundModal
          order={refundFor}
          onClose={() => setRefundFor(null)}
          onDone={(id, status) =>
            setRows((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)))
          }
        />
      ) : null}

      {markFor ? (
        <MarkPaidModal
          order={markFor}
          onClose={() => setMarkFor(null)}
          onDone={(id) =>
            setRows((prev) =>
              prev.map((o) => (o.id === id ? { ...o, status: "paid", paid_at: new Date().toISOString() } : o))
            )
          }
        />
      ) : null}
    </div>
  );
}
