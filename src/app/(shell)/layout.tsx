import { SiteHeader } from "@/components/site-header";
import { Footer } from "@/components/footer";
import { ActiveHeartbeat } from "@/components/active-heartbeat";

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col overflow-x-clip bg-black text-white">
      <ActiveHeartbeat />
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
