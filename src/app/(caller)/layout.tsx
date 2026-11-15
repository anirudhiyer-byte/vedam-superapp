// Caller route group — bare full-screen shell (no admin nav, no profile gate).
// The page itself is role-gated server-side.
export default function CallerLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-black text-white">{children}</div>;
}
