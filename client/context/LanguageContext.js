"use client";
import { createContext, useContext, useEffect, useState } from "react";

/* 轻量双语：浏览器语言自动检测 + localStorage 持久化 + 手动切换。
   覆盖营销/认证/计费表面；画布工作区文案保持英文工业风。

   语言判定（海外先行战略）：
   1. localStorage 里有用户手动选择 → 用户选择优先；
   2. 否则严格按 navigator.language：zh 开头 → 中文，其余一律英文。
   SSR / 首帧无 navigator 可读，默认英文兜底——海外先行意味着
   "拿不准时给英文"，而不是旧逻辑的"无脑默认中文"。 */

const LanguageContext = createContext({ lang: "en", setLang: () => {} });

export function LanguageProvider({ children }) {
  // 初始值必须是 SSR 可确定的常量（不能读 navigator/localStorage），
  // 否则服务端与客户端首帧不一致会触发水合错误；检测放 useEffect 里做。
  const [lang, setLangState] = useState("en");

  useEffect(() => {
    // useEffect 只在客户端跑，此处访问 window/navigator 是 SSR 安全的
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem("lang");
    if (saved === "zh" || saved === "en") {
      // 用户手动选过语言：记忆优先，不再嗅探浏览器
      setLangState(saved);
    } else {
      // 无记忆时对称判定：zh* → 中文，其余全部英文（不偏袒任何一侧）
      setLangState(navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en");
    }
  }, []);

  const setLang = (next) => {
    localStorage.setItem("lang", next);
    setLangState(next);
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang }}>
      {children}
    </LanguageContext.Provider>
  );
}

export const useLang = () => useContext(LanguageContext);
