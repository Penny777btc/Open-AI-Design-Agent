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
  btnGhost,
  btnDanger,
  LoadMore,
} from "./ui";

const PAGE = 60;

// 下架确认弹层：说明会删除文件且不可恢复（sudo）。
function TakedownModal({ asset, onClose, onDone }) {
  const { run } = useSudo();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await run((pw) =>
        axios.delete(`${ADMIN}/assets/${asset.id}`, sudoConfig(pw))
      );
      if (!res) return; // 用户取消 sudo
      toast.success("已下架该内容");
      onDone(asset.id);
      onClose();
    } catch (err) {
      toast.error(errMsg(err, "下架失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay onClose={onClose}>
      <div className="micro-label text-red-400">内容下架确认</div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={asset.url}
        alt={asset.prompt || "asset"}
        className="w-full max-h-48 object-contain rounded-sm border border-white/[0.08] bg-black/40"
      />
      <p className="text-[12px] text-gray-400 leading-relaxed">
        即将下架 <span className="text-white font-mono">{asset.user_email}</span> 的该内容。
        <span className="text-red-400">这将永久删除存储文件与记录，不可恢复。</span>
      </p>
      <div className="flex justify-end gap-3 mt-1">
        <button onClick={onClose} className={btnGhost}>取消</button>
        <button onClick={submit} disabled={busy} className={btnDanger}>
          {busy ? "下架中…" : "确认下架"}
        </button>
      </div>
    </Overlay>
  );
}

export default function AssetsTab({ readOnly }) {
  const [rows, setRows] = useState([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [inited, setInited] = useState(false);
  // 三态补全：内容巡查是运营红线——断网/接口挂时整页显示「暂无内容」会被误读成「没有违规」
  const [error, setError] = useState(false);
  const [takedownFor, setTakedownFor] = useState(null);

  const load = useCallback(async (reset) => {
    setLoading(true);
    setError(false); // 重试/翻页前清掉上次的错误态
    const off = reset ? 0 : offset;
    try {
      const { data } = await adminGet(`/assets/recent?limit=${PAGE}&offset=${off}`);
      setRows((prev) => (reset ? data : [...prev, ...data]));
      setOffset(off + data.length);
      setDone(data.length < PAGE);
    } catch (err) {
      toast.error(errMsg(err, "加载内容失败"));
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

  // 原来这里有个 `inited && rows.length === 0` 的整页早退「暂无内容」：
  // error 也命中它，等于把「加载失败」伪装成「没有内容」。改为统一走下方 LoadMore 的三态分支。

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
        {rows.map((a) => (
          <div
            key={a.id}
            className="group relative aspect-square overflow-hidden rounded-sm border border-white/[0.08] bg-bg-card hover:border-white/25 transition-all"
          >
            <a
              href={a.url}
              target="_blank"
              rel="noreferrer"
              className="block w-full h-full"
              title={a.prompt || ""}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={a.url}
                alt={a.prompt || "asset"}
                loading="lazy"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black/85 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2 gap-1 pointer-events-none">
                <div className="text-[10px] text-white font-mono truncate">{a.user_email}</div>
                <div className="text-[10px] text-gray-400 leading-snug line-clamp-3">
                  {(a.prompt || "").slice(0, 60)}
                </div>
                {a.source_tool ? (
                  <div className="text-[9px] text-gray-600 font-mono uppercase tracking-[0.15em]">{a.source_tool}</div>
                ) : null}
              </div>
            </a>
            {!readOnly ? (
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setTakedownFor(a);
                }}
                className="absolute top-1.5 right-1.5 z-10 opacity-0 group-hover:opacity-100 transition-opacity px-2.5 py-1 bg-red-500/20 border border-red-500/50 text-red-300 rounded-sm text-[9px] font-bold uppercase tracking-[0.15em] hover:bg-red-500/35 backdrop-blur-sm"
              >
                下架
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <LoadMore
        onClick={() => load(false)}
        loading={loading}
        done={done && rows.length > 0}
        empty={inited && rows.length === 0}
        emptyText="暂无内容"
        error={error}
        errorText="加载内容失败"
      />

      {takedownFor ? (
        <TakedownModal
          asset={takedownFor}
          onClose={() => setTakedownFor(null)}
          onDone={(id) => setRows((prev) => prev.filter((x) => x.id !== id))}
        />
      ) : null}
    </div>
  );
}
