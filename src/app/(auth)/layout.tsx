import Link from "next/link";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-screen">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(640px 420px at 82% 0%, var(--glow-violet), transparent 62%), radial-gradient(520px 420px at 0% 100%, var(--glow-orange), transparent 60%)",
        }}
      />
      <header className="flex h-16 items-center justify-between px-5 sm:px-8">
        <Link href="/" aria-label="Vedam home">
          <Logo />
        </Link>
        <ThemeToggle />
      </header>
      <main className="flex min-h-[calc(100vh-4rem)] items-start justify-center px-4 pb-16 pt-6 sm:items-center sm:pt-0">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
