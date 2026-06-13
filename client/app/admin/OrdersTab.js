"use client";

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { adminGet, errMsg, cardCls, Badge, LoadMore, Th, fmtMoney, fmtDate } from "./ui";

const PAGE = 50;

export default function OrdersTab() {
  const [rows, setRows] = useState([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [inited, setInited] = useState(false);

  const load = useCallback(async (reset) => {
    setLoading(true);
    const off = reset ? 0 : offset;
    try {
      const { data } = await adminGet(`/orders?limit=${PAGE}&offset=${off}`);
      setRows((prev) => (reset ? data : [...prev, ...data]));
      setOffset(off + data.length);
      setDone(data.length < PAGE);
    } catch (err) {
      toast.error(errMsg(err, "加载订单失败"));
    } finally {
      setLoading(false);
      setInited(true);
    }
  }, [offset]);

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
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
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.05]">
          {rows.map((o) => (
            <tr key={o.id} className="hover:bg-white/[0.02]">
              <td className="px-4 py-3 text-gray-300">{o.user_email}</td>
              <td className="px-4 py-3 font-data text-white">{fmtMoney(o.amount_cents, o.currency)}</td>
              <td className="px-4 py-3 font-data text-gray-400">{o.credits}</td>
              <td className="px-4 py-3">
                <Badge tone={o.status === "paid" ? "paid" : "muted"}>{o.status}</Badge>
              </td>
              <td className="px-4 py-3 text-gray-600 font-mono text-[11px]">{o.provider || "—"}</td>
              <td className="px-4 py-3 text-gray-600 font-mono text-[11px]">{fmtDate(o.paid_at || o.created_at)}</td>
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
      />
    </div>
  );
}
