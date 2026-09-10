import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://one.vedam.org";
  const routes = ["", "/events", "/codesprint", "/predict", "/login", "/register", "/privacy", "/terms"];
  const now = new Date();
  return routes.map((r) => ({
    url: `${base}${r}`,
    lastModified: now,
    changeFrequency: r === "" || r === "/events" ? "daily" : "weekly",
    priority: r === "" ? 1 : r === "/events" ? 0.9 : 0.6,
  }));
}
