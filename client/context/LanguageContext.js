"use client";
import { createContext, useContext, useEffect, useState } from "react";

/* 轻量双语：浏览器语言自动检测 + localStorage 持久化 + 手动切换。
   覆盖营销/认证/计费表面；画布工作区文案保持英文工业风。 */

const LanguageContext = createContext({ lang: "zh", setLang: () => {} });

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState("zh");

  useEffect(() => {
    const saved = localStorage.getItem("lang");
    if (saved === "zh" || saved === "en") {
      setLangState(saved);
    } else if (!navigator.language?.toLowerCase().startsWith("zh")) {
      setLangState("en");
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
