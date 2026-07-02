"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  ADMIN,
  adminGet,
  errMsg,
  sudoConfig,
  useSudo,
  Overlay,
  Chip,
  CsvButton,
  cardCls,
  inputCls,
  btnPrimary,
  btnGhost,
  btnDanger,
  Badge,
  LoadMore,
  Th,
  fmtDate,
  fmtBytes,
} from "./ui";
import axios from "axios";

const PAGE = 50;

const JOB_TONE = { done: "ok", failed: "fail", rejected: "fail" };
const ORDER_TONE = { paid: "paid" };

function userTone(u) {
  if (u.disabled_at) return "banned";
  if (u.role === "admin") return "admin";
  return "ok";
}
function userStatus(u) {
  if (u.disabled_at) return "已封禁";
  if (u.role === "admin") return "admin";
  return "正常";
}

// 行内展开的用户详情：积分流水 / 任务 / 订单 / 配额。
function UserDetail({ id, readOnly, onQuota }) {
  const [detail, setDetail] = useState(null);
  const [err, setErr] = useState(null);
  const [quotaFor, setQuotaFor] = useState(false);

  useEffect(() => {
    let alive = true;
    adminGet(`/users/${id}`)
      .then(({ data }) => {
        if (alive) setDetail(data);
      })
      .catch((e) => {
        if (alive) setErr(errMsg(e, "加载用户详情失败"));
      });
    return () => {
      alive = false;
    };
  }, [id]);

  if (err) return <div className="px-5 py-4 text-[12px] text-red-400">{err}</div>;
  if (!detail) return <div className="px-5 py-4 text-[12px] text-gray-600">加载中…</div>;

  // 后端用户详情当前不回传 doc_daily_limit；null/undefined 一律按全局默认 20 展示。
  const quota = detail.doc_daily_limit;

  const Mini = ({ title, children, empty }) => (
    <div className="flex flex-col gap-2">
      <div className="micro-label">{title}</div>
      <div className="border border-white/[0.06] rounded-sm divide-y divide-white/[0.05] max-h-56 overflow-auto">
        {empty ? <div className="px-3 py-3 text-[11px] text-gray-600">暂无</div> : children}
      </div>
    </div>
  );

  return (
    <div className="px-5 py-5 bg-white/[0.015] grid md:grid-cols-3 gap-5">
      <Mini title="积分流水" empty={!detail.ledger?.length}>
        {detail.ledger?.map((l) => (
          <div key={l.id} className="px-3 py-2 flex items-center gap-2 text-[11px]">
            <span className={`font-data w-12 shrink-0 ${l.delta >= 0 ? "text-white" : "text-gray-500"}`}>
              {l.delta >= 0 ? `+${l.delta}` : l.delta}
            </span>
            <span className="text-gray-500 flex-1 truncate" title={l.memo}>{l.memo || l.kind}</span>
            <span className="font-data text-gray-600">{l.balance_after}</span>
          </div>
        ))}
      </Mini>
      <Mini title="任务" empty={!detail.jobs?.length}>
        {detail.jobs?.map((j) => (
          <div key={j.id} className="px-3 py-2 flex items-center gap-2 text-[11px]">
            <Badge tone={JOB_TONE[j.status] || "muted"}>{j.status}</Badge>
            <span className="text-gray-500 flex-1 truncate">{j.kind}</span>
            <span className="text-gray-700 font-mono">{fmtDate(j.created_at)}</span>
          </div>
        ))}
      </Mini>
      <Mini title="订单" empty={!detail.orders?.length}>
        {detail.orders?.map((o) => (
          <div key={o.id} className="px-3 py-2 flex items-center gap-2 text-[11px]">
            <Badge tone={ORDER_TONE[o.status] || "muted"}>{o.status}</Badge>
            <span className="font-data text-gray-400">${((o.amount_cents || 0) / 100).toFixed(2)}</span>
            <span className="text-gray-600 flex-1 truncate">+{o.credits}</span>
            <span className="text-gray-700 font-mono">{fmtDate(o.created_at)}</span>
          </div>
        ))}
      </Mini>
      <div className="md:col-span-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px] text-gray-600 font-mono">
        <span>存储用量：{fmtBytes(detail.storage_bytes)}</span>
        {detail.balance != null ? <span>当前余额：{detail.balance}</span> : null}
        <span className="flex items-center gap-2">
          每日文档配额：
          <span className="text-gray-300">{quota == null ? "默认 20" : quota}</span>
          {!readOnly ? (
            <button className={btnGhost} onClick={() => setQuotaFor(true)}>修改</button>
          ) : null}
        </span>
      </div>
      {quotaFor ? (
        <QuotaModal
          user={{ id, email: detail.email }}
          current={quota}
          onClose={() => setQuotaFor(false)}
          onDone={(val) => {
            setDetail((d) => ({ ...d, doc_daily_limit: val }));
            onQuota?.(id, val);
          }}
        />
      ) : null}
    </div>
  );
}

// 每日文档配额弹层（sudo）。空 = 恢复默认（null）；否则 1–1000 整数。
function QuotaModal({ user, current, onClose, onDone }) {
  const { run } = useSudo();
  const [val, setVal] = useState(current == null ? "" : String(current));
  const [busy, setBusy] = useState(false);

  const trimmed = val.trim();
  const num = parseInt(trimmed, 10);
  const isDefault = trimmed === "";
  const valid = isDefault || (Number.isInteger(num) && num >= 1 && num <= 1000);

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const payload = { doc_daily_limit: isDefault ? null : num };
      const res = await run((pw) =>
        axios.patch(`${ADMIN}/users/${user.id}/quota`, payload, sudoConfig(pw))
      );
      if (!res) return; // 用户取消 sudo
      toast.success("已更新每日文档配额");
      onDone(res.data.doc_daily_limit);
      onClose();
    } catch (err) {
      toast.error(errMsg(err, "更新配额失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay onClose={onClose}>
      <div className="flex flex-col gap-2">
        <div className="micro-label">每日文档配额</div>
        <div className="text-[12px] text-gray-400 font-mono">{user.email}</div>
      </div>
      <div className="flex flex-col gap-1 mt-1">
        <label className="micro-label">每日上限（1–1000，留空 = 恢复默认 20）</label>
        <input
          value={val}
          onChange={(e) => setVal(e.target.value.replace(/[^\d]/g, ""))}
          placeholder="默认 20"
          inputMode="numeric"
          className={inputCls}
          autoFocus
        />
        {!valid ? <span className="text-[10px] text-red-400 font-mono">需为 1–1000 的整数，或留空恢复默认</span> : null}
      </div>
      <div className="flex justify-end gap-3 mt-2">
        <button onClick={onClose} className={btnGhost}>取消</button>
        <button onClick={submit} disabled={!valid || busy} className={btnPrimary}>
          {busy ? "提交中…" : "确认"}
        </button>
      </div>
    </Overlay>
  );
}

// 调整积分弹层（sudo）
function CreditsModal({ user, onClose, onDone }) {
  const { run } = useSudo();
  const [delta, setDelta] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);

  const deltaNum = parseInt(delta, 10);
  const memoOk = memo.trim().length >= 2 && memo.trim().length <= 200;
  const deltaOk = Number.isInteger(deltaNum) && deltaNum !== 0;
  const valid = memoOk && deltaOk;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const res = await run((pw) =>
        axios.post(
          `${ADMIN}/users/${user.id}/credits`,
          { delta: deltaNum, memo: memo.trim() },
          sudoConfig(pw)
        )
      );
      if (!res) return; // 用户取消 sudo
      toast.success(`已调整：余额 ${res.data.balance}`);
      onDone(user.id, res.data.balance);
      onClose();
    } catch (err) {
      toast.error(errMsg(err, "调整积分失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay onClose={onClose}>
      <div className="flex flex-col gap-2">
        <div className="micro-label">调整积分</div>
        <div className="text-[12px] text-gray-400 font-mono">{user.email}</div>
      </div>
      <div className="flex flex-col gap-3 mt-1">
        <div className="flex flex-col gap-1">
          <label className="micro-label">增量（正负整数，不可为 0）</label>
          <input
            value={delta}
            onChange={(e) => setDelta(e.target.value.replace(/[^\d-]/g, ""))}
            placeholder="例如 100 或 -50"
            inputMode="numeric"
            className={inputCls}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="micro-label">原因（必填，2–200 字）</label>
          <input
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="如：补偿失败任务"
            maxLength={200}
            className={inputCls}
          />
          {memo.length > 0 && !memoOk ? (
            <span className="text-[10px] text-red-400 font-mono">原因需 2–200 字</span>
          ) : null}
        </div>
      </div>
      <div className="flex justify-end gap-3 mt-2">
        <button onClick={onClose} className={btnGhost}>取消</button>
        <button onClick={submit} disabled={!valid || busy} className={btnPrimary}>
          {busy ? "提交中…" : "确认调整"}
        </button>
      </div>
    </Overlay>
  );
}

// 封禁弹层：要求输入用户邮箱二次确认，防误点（sudo）
function BanModal({ user, onClose, onDone }) {
  const { run } = useSudo();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const match = confirm.trim().toLowerCase() === (user.email || "").toLowerCase();

  const submit = async () => {
    if (!match) return;
    setBusy(true);
    try {
      const res = await run((pw) =>
        axios.post(`${ADMIN}/users/${user.id}/ban`, {}, sudoConfig(pw))
      );
      if (!res) return; // 用户取消 sudo
      toast.success("已封禁该用户");
      onDone(user.id, res.data.disabled_at || new Date().toISOString());
      onClose();
    } catch (err) {
      toast.error(errMsg(err, "封禁失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay onClose={onClose}>
      <div className="micro-label text-red-400">封禁确认</div>
      <p className="text-[12px] text-gray-400 leading-relaxed">
        即将封禁 <span className="text-white font-mono">{user.email}</span>。请输入该用户邮箱以确认。
      </p>
      <input
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder={user.email}
        className={inputCls}
        autoFocus
      />
      <div className="flex justify-end gap-3 mt-1">
        <button onClick={onClose} className={btnGhost}>取消</button>
        <button onClick={submit} disabled={!match || busy} className={btnDanger}>
          {busy ? "封禁中…" : "确认封禁"}
        </button>
      </div>
    </Overlay>
  );
}

const STATUS_CHIPS = [
  { key: "all", label: "全部" },
  { key: "banned", label: "已封禁" },
  { key: "staff", label: "员工" },
];

export default function UsersTab({ readOnly }) {
  const { run } = useSudo();
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("all");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [inited, setInited] = useState(false);
  // 三态补全：加载失败 ≠ 「没有匹配的用户」，留可见 error 态 + 重试
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [creditsFor, setCreditsFor] = useState(null);
  const [banFor, setBanFor] = useState(null);
  const debTimer = useRef(null);

  // 防抖搜索 300ms
  useEffect(() => {
    if (debTimer.current) clearTimeout(debTimer.current);
    debTimer.current = setTimeout(() => setDebounced(query.trim()), 300);
    return () => debTimer.current && clearTimeout(debTimer.current);
  }, [query]);

  const load = useCallback(
    async (reset) => {
      setLoading(true);
      setError(false); // 重试/翻页/换筛选前清掉上次的错误态
      const off = reset ? 0 : offset;
      try {
        const q = encodeURIComponent(debounced);
        const { data } = await adminGet(
          `/users?query=${q}&status=${status}&limit=${PAGE}&offset=${off}`
        );
        setRows((prev) => (reset ? data : [...prev, ...data]));
        setOffset(off + data.length);
        setDone(data.length < PAGE);
      } catch (err) {
        toast.error(errMsg(err, "加载用户失败"));
        setError(true);
      } finally {
        setLoading(false);
        setInited(true);
      }
    },
    [offset, debounced, status]
  );

  // 搜索词 / 状态筛选变化重置列表
  useEffect(() => {
    setExpanded(null);
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, status]);

  const patchRow = (id, patch) =>
    setRows((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));

  const unban = async (u) => {
    try {
      const res = await run((pw) =>
        axios.post(`${ADMIN}/users/${u.id}/unban`, {}, sudoConfig(pw))
      );
      if (!res) return; // 用户取消 sudo
      toast.success("已解封");
      patchRow(u.id, { disabled_at: null });
    } catch (err) {
      toast.error(errMsg(err, "解封失败"));
    }
  };

  const csvCols = [
    { key: "id", label: "用户ID" },
    { key: "email", label: "邮箱" },
    { key: "name", label: "姓名" },
    { key: "role", label: "角色" },
    { key: "balance", label: "余额" },
    { key: "created_at", label: "注册时间" },
    { label: "状态", get: (u) => (u.disabled_at ? "已封禁" : "正常") },
  ];

  return (
    <div className="flex flex-col gap-4">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="搜索邮箱 / 姓名 / 精确 ID"
        className={inputCls}
      />

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {STATUS_CHIPS.map((c) => (
            <Chip key={c.key} active={status === c.key} onClick={() => setStatus(c.key)}>
              {c.label}
            </Chip>
          ))}
        </div>
        <CsvButton filename="users" columns={csvCols} rows={rows} />
      </div>

      <div className={`${cardCls} overflow-hidden`}>
        <table className="w-full text-[12px]">
          <thead className="border-b border-white/[0.08]">
            <tr>
              <Th>邮箱</Th>
              <Th>余额</Th>
              <Th>注册时间</Th>
              <Th>状态</Th>
              <Th className="text-right">操作</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.05]">
            {rows.map((u) => (
              <Fragment key={u.id}>
                <tr
                  className="hover:bg-white/[0.02] cursor-pointer"
                  onClick={() => setExpanded(expanded === u.id ? null : u.id)}
                >
                  <td className="px-4 py-3 text-gray-200">
                    <span className="text-gray-600 mr-1.5 font-mono">{expanded === u.id ? "▾" : "▸"}</span>
                    {u.email}
                  </td>
                  <td className="px-4 py-3 font-data text-white">{u.balance}</td>
                  <td className="px-4 py-3 text-gray-600 font-mono text-[11px]">{fmtDate(u.created_at)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={userTone(u)}>{userStatus(u)}</Badge>
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    {readOnly ? (
                      <div className="flex justify-end text-gray-700 font-mono text-[11px]">—</div>
                    ) : (
                      <div className="flex justify-end gap-2">
                        <button className={btnGhost} onClick={() => setCreditsFor(u)}>调整积分</button>
                        {u.disabled_at ? (
                          <button className={btnGhost} onClick={() => unban(u)}>解封</button>
                        ) : (
                          <button className={btnDanger} onClick={() => setBanFor(u)}>封禁</button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
                {expanded === u.id ? (
                  <tr>
                    <td colSpan={5} className="p-0 border-t border-white/[0.06]">
                      <UserDetail id={u.id} readOnly={readOnly} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
        <LoadMore
          onClick={() => load(false)}
          loading={loading}
          done={done && rows.length > 0}
          empty={inited && rows.length === 0}
          emptyText="没有匹配的用户"
          error={error}
          errorText="加载用户失败"
        />
      </div>

      {creditsFor ? (
        <CreditsModal
          user={creditsFor}
          onClose={() => setCreditsFor(null)}
          onDone={(id, balance) => patchRow(id, { balance })}
        />
      ) : null}
      {banFor ? (
        <BanModal
          user={banFor}
          onClose={() => setBanFor(null)}
          onDone={(id, disabled_at) => patchRow(id, { disabled_at })}
        />
      ) : null}
    </div>
  );
}
