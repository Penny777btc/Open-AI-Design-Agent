const SITE = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3100";

export default function robots() {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/dashboard", "/canvas", "/billing", "/account"],
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
