"use client";

import { ThemeProvider } from "next-themes";
import { ApiProvider } from "@/context/ApiContext";
import { LanguageProvider } from "@/context/LanguageContext";

export function Providers({ children }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <LanguageProvider>
        <ApiProvider>
          {children}
        </ApiProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
