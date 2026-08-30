import { Sidebar } from "@/components/sidebar";
import { SidebarProvider } from "@/components/sidebar-context";
import { Topbar } from "@/components/topbar";
import { Footer } from "@/components/footer";

export default function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1">{children}</main>
        <Footer />
      </div>
    </div>
    </SidebarProvider>
  );
}
