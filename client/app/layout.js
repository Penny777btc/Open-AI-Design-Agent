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
  title: "Picsmith（图匠）— AI Design Agent",
  description: "从一句话到成套设计：电商主图、Logo、自媒体封面的 AI 设计 Agent",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${syne.variable} ${robotoMono.variable}`}>
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
