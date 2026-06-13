"use client";

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { adminGet, errMsg, LoadMore } from "./ui";

const PAGE = 60;

export default function AssetsTab() {
  const [rows, setRows] = useState([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [inited, setInited] = useState(false);

  const load = useCallback(async (reset) => {
    setLoading(true);
    const off = reset ? 0 : offset;
    try {
      const { data } = await adminGet(`/assets/recent?limit=${PAGE}&offset=${off}`);
      setRows((prev) => (reset ? data : [...prev, ...data]));
      setOffset(off + data.length);
      setDone(data.length < PAGE);
    } catch (err) {
      toast.error(errMsg(err, "加载内容失败"));
    } finally {
      setLoading(false);
      setInited(true);
    }
  }, [offset]);

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (inited && rows.length === 0) {
    return <div className="px-5 py-12 text-center text-[13px] text-gray-600">暂无内容</div>;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
        {rows.map((a) => (
          <a
            key={a.id}
            href={a.url}
            target="_blank"
            rel="noreferrer"
            className="group relative aspect-square overflow-hidden rounded-sm border border-white/[0.08] bg-bg-card hover:border-white/25 transition-all"
            title={a.prompt || ""}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={a.url}
              alt={a.prompt || "asset"}
              loading="lazy"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-black/85 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2 gap-1">
              <div className="text-[10px] text-white font-mono truncate">{a.user_email}</div>
              <div className="text-[10px] text-gray-400 leading-snug line-clamp-3">
                {(a.prompt || "").slice(0, 60)}
              </div>
              {a.source_tool ? (
                <div className="text-[9px] text-gray-600 font-mono uppercase tracking-[0.15em]">{a.source_tool}</div>
              ) : null}
            </div>
          </a>
        ))}
      </div>
      <LoadMore
        onClick={() => load(false)}
        loading={loading}
        done={done && rows.length > 0}
        empty={false}
      />
    </div>
  );
}
