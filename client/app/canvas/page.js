"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useApi } from "@/context/ApiContext";
import { CreativeCanvas } from "design-agent";
import { useTheme } from "next-themes";

/* 审计 U5：画布暂未做触屏适配，移动端给出可关闭的提示 */
function MobileNotice() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (window.innerWidth < 768 && !sessionStorage.getItem("mobile-notice-dismissed")) {
      setShow(true);
    }
  }, []);
  if (!show) return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-[200] bg-white text-black px-4 py-2.5 flex items-center justify-between gap-3 text-[12px] font-semibold">
      <span>📱 画布在手机上体验有限，建议使用桌面浏览器获得完整功能</span>
      <button
        onClick={() => { sessionStorage.setItem("mobile-notice-dismissed", "1"); setShow(false); }}
        className="shrink-0 px-2 py-0.5 border border-black/30 rounded-sm text-[10px] font-bold uppercase"
      >
        知道了
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

  return (
    <CreativeCanvas
      sessionId={sessionId}
      initialAssetParam={initialAssetParam}
      user={userData}
      userBalanceLabel={`CREDITS ${userData?.balance ?? 0}`}
      onBalanceChange={fetchUserData}
      isAuthorized={true}
      theme={resolvedTheme}
      setTheme={setTheme}
    />
  );
}

export default function CanvasPage() {
  return (
    <div className="h-dvh w-full">
      <MobileNotice />
      <Suspense fallback={<div className="h-full w-full flex items-center justify-center">Loading Workspace...</div>}>
        <CanvasLoader />
      </Suspense>
    </div>
  );
}
