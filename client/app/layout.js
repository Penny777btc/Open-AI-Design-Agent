import { Inter, Syne, Roboto_Mono } from "next/font/google";
// design-agent 的样式必须先于 globals.css 注入，且全局加载：
// 只在 /canvas 引入会导致客户端导航后 CSS 注入顺序变化，首页风格漂移
import "design-agent/dist/tailwind.css";
import "./globals.css";
import { Providers } from "./providers";
import { Toaster } from "react-hot-toast";

const inter = Inter({ subsets: ["latin"] });
const syne = Syne({ subsets: ["latin"], weight: ["700", "800"], variable: "--font-syne" });
const robotoMono = Roboto_Mono({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-roboto-mono" });

export const metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3100"),
  title: "Picsmith（图匠）— AI Design Agent",
  description: "从一句话到成套设计：电商主图、自媒体封面、PPT、Logo 的 AI 设计 Agent。From one sentence to finished designs.",
  openGraph: {
    title: "Picsmith（图匠）— AI Design Agent",
    description: "从一句话到成套设计 · From one sentence to finished designs",
    siteName: "Picsmith",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh" suppressHydrationWarning className={`${syne.variable} ${robotoMono.variable}`}>
      <head>
        {/* 隐私友好型分析（配置 NEXT_PUBLIC_PLAUSIBLE_DOMAIN 后激活） */}
        {process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN && (
          <script
            defer
            data-domain={process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN}
            src="https://plausible.io/js/script.js"
          />
        )}
      </head>
      <body className={`${inter.className} antialiased`}>
        <Providers>
          {children}
        </Providers>
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: "#0d0d0f",
              color: "#ffffff",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "4px",
              fontSize: "12px",
            },
          }}
        />
      </body>
    </html>
  );
}
