"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useApi } from "@/context/ApiContext";
import { CreativeCanvas } from "design-agent";
import { useTheme } from "next-themes";
import { useLang } from "@/context/LanguageContext";
import { COPY } from "@/lib/copy";

/* 审计 U5：画布暂未做触屏适配，移动端给出可关闭的提示。
   文案走 copy.js 的 canvas 段——之前中文写死，英文用户进画布先看到一条中文横幅 */
function MobileNotice() {
  const { lang } = useLang();
  const t = COPY[lang].canvas;
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (window.innerWidth < 768 && !sessionStorage.getItem("mobile-notice-dismissed")) {
      setShow(true);
    }
  }, []);
  if (!show) return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-[200] bg-white text-black px-4 py-2.5 flex items-center justify-between gap-3 text-[12px] font-semibold">
      <span>{t.mobileNotice}</span>
      <button
        onClick={() => { sessionStorage.setItem("mobile-notice-dismissed", "1"); setShow(false); }}
        className="shrink-0 px-2 py-0.5 border border-black/30 rounded-sm text-[10px] font-bold uppercase"
      >
        {t.gotIt}
      </button>
    </div>
  );
}

function CanvasLoader() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session");
  const initialAssetParam = searchParams.get("a");
  const { userData, fetchUserData } = useApi();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { lang } = useLang();

  return (
    <CreativeCanvas
      sessionId={sessionId}
      initialAssetParam={initialAssetParam}
      user={userData}
      /* 余额徽标随站点语言：中文「积分 N」/ 英文 "CREDITS N"——之前写死英文，
         与中文站的术语统一规则（同屏禁 credits/积分混写）冲突 */
      userBalanceLabel={`${COPY[lang].canvas.credits} ${userData?.balance ?? 0}`}
      onBalanceChange={fetchUserData}
      isAuthorized={true}
      theme={resolvedTheme}
      setTheme={setTheme}
    />
  );
}

export default function CanvasPage() {
  const { lang } = useLang();
  return (
    <div className="h-dvh w-full">
      <MobileNotice />
      {/* 加载态双语：之前写死 "Loading Workspace..." */}
      <Suspense fallback={<div className="h-full w-full flex items-center justify-center">{COPY[lang].canvas.loading}</div>}>
        <CanvasLoader />
      </Suspense>
    </div>
  );
}
