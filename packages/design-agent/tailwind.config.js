module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  // preflight 由 client 的 Tailwind v4 提供；这里再出一份会形成双 reset，
  // 且随 CSS 注入顺序不同导致页面风格漂移
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        primary: "var(--primary)",
        divider: "var(--border-subtle)",
        "bg-page": "var(--bg-page)",
        "bg-card": "var(--bg-card)",
        "bg-card-hover": "var(--bg-card-hover)",
        "primary-text": "var(--text-primary)",
        "secondary-text": "var(--text-secondary)",
        "border-main": "var(--border-default)",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
    /* 工业风圆角（与 client globals.css 的 @theme 保持一致） */
    borderRadius: {
      none: "0",
      sm: "0.125rem",
      DEFAULT: "0.25rem",
      md: "0.25rem",
      lg: "0.375rem",
      xl: "0.5rem",
      "2xl": "0.75rem",
      "3xl": "1rem",
      full: "9999px",
    },
  },
  plugins: [],
};
