"use client";
import { usePathname } from "next/navigation";
import { SiteHeader } from "@/components/site-header";

/**
 * Admin chrome. Most admin routes get the SiteHeader on top; the VSAT Admin Panel
 * (and anything under /admin/vsat) is a full-screen shell like the Growth panel, so
 * it renders bare — no top nav bar.
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const bare = pathname?.startsWith("/admin/vsat");
  if (bare) return <div className="min-h-screen bg-black text-white">{children}</div>;
  return (
    <div className="flex min-h-screen flex-col bg-black text-white">
      <SiteHeader />
      <main className="flex-1">{children}</main>
    </div>
  );
}
