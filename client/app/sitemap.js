const SITE = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3100";

export default function sitemap() {
  return [
    { url: `${SITE}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE}/login`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE}/register`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE}/legal/terms`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE}/legal/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE}/legal/refund`, changeFrequency: "yearly", priority: 0.2 },
  ];
}
