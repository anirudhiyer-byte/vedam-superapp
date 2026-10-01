import { SiteHeader } from "@/components/site-header";
import { Footer } from "@/components/footer";
import { TrafficTracker } from "@/components/traffic-tracker";

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-black text-white">
      <TrafficTracker />
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
