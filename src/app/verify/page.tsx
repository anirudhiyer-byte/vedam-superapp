import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/logo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Verify certificate" };

type Data = { valid?: boolean; full_name: string; event_name: string; issued_on: string; kind?: string; position?: string; source?: string };

const posLabel = (p?: string) => p === "1st" ? "🥇 First Place" : p === "2nd" ? "🥈 Second Place" : p === "3rd" ? "🥉 Third Place" : "🏆 Winner";
const typeLabel = (d: Data) => d.source === "codesprint" ? "Certificate of Completion" : d.kind === "winner" ? "Certificate of Excellence" : "Certificate of Participation";

export default async function Page({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  const certId = (c || "").trim();

  // ---- verification runs on the SERVER; the rendered result is server-attested ----
  let data: Data | null = null;
  if (certId) {
    const supabase = await createClient();
    const { data: rows } = await supabase.rpc("verify_certificate", { p_id: certId });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (row?.valid) data = row as Data;
  }
  const valid = !!data;

  return (
    <div className="min-h-screen" style={{ background: "radial-gradient(820px 500px at 88% -12%, var(--glow-violet), transparent 60%), radial-gradient(680px 500px at -12% 110%, var(--glow-orange), transparent 60%)" }}>
      <div className="mx-auto max-w-xl px-6 py-14">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="text-[#12a05a]">🔒</span>
          <span className="font-mono text-xs font-semibold uppercase tracking-wide text-muted">Verified by</span>
          <Logo />
        </div>

        {!certId ? (
          <div className="rounded-2xl border border-border bg-surface p-10 text-center font-body text-sm text-muted">No certificate ID provided.</div>
        ) : !valid ? (
          <div className="overflow-hidden rounded-3xl border border-border bg-surface shadow-[0_30px_70px_-34px_rgba(43,19,92,0.5)]">
            <div className="bg-[linear-gradient(125deg,#b42318,#e0483d)] p-8 text-center text-white">
              <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full border-2 border-white/40 bg-white/15 text-3xl">✕</div>
              <div className="font-display text-xl font-extrabold">Not verified</div>
              <div className="mt-1 text-sm text-white/85">We couldn&apos;t find a certificate with this ID.</div>
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-3xl border border-border bg-surface shadow-[0_30px_70px_-34px_rgba(43,19,92,0.5)]">
            <div className="bg-[linear-gradient(125deg,#146c43,#12a05a)] p-8 text-center text-white">
              <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full border-2 border-white/40 bg-white/15 text-3xl">✓</div>
              <div className="font-display text-xl font-extrabold">Certificate Verified</div>
              <div className="mt-1 text-sm text-white/85">A genuine credential issued by Vedam School of Technology</div>
            </div>
            <div className="p-7 sm:p-8">
              <div className="border-b border-border pb-6 text-center">
                <div className="font-mono text-[11px] uppercase tracking-wide text-muted">Awarded to</div>
                <div className="mt-1.5 font-display text-3xl font-extrabold text-heading">{data!.full_name}</div>
                <div className="mt-2 font-body text-[15px] text-foreground/80">
                  {data!.source === "codesprint" ? <>for completing <b>{data!.event_name}</b> in CodeSprint</> : data!.kind === "winner" ? <>for <b>winning</b> {data!.event_name}</> : <>for participating in <b>{data!.event_name}</b></>}
                </div>
                {data!.kind === "winner" && data!.position && (
                  <span className="mt-3 inline-block rounded-full bg-[linear-gradient(120deg,#B8860B,#F5C542)] px-3.5 py-1 font-display text-xs font-extrabold text-[#3a2a00]">{posLabel(data!.position)}</span>
                )}
              </div>
              <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-border">
                <div className="bg-surface p-4"><div className="font-mono text-[10px] uppercase tracking-wide text-muted">Issued on</div><div className="mt-1 font-display text-[15px] font-bold text-heading">{new Date(data!.issued_on).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}</div></div>
                <div className="bg-surface p-4"><div className="font-mono text-[10px] uppercase tracking-wide text-muted">Type</div><div className="mt-1 font-display text-[15px] font-bold text-heading">{typeLabel(data!)}</div></div>
                <div className="col-span-2 bg-surface p-4"><div className="font-mono text-[10px] uppercase tracking-wide text-muted">Certificate ID</div><div className="mt-1 break-all font-mono text-[13px] font-semibold text-foreground">{certId}</div></div>
              </div>
            </div>
            <div className="border-t border-border p-4 text-center font-body text-xs text-muted">Issued by <b className="text-heading">Vedam School of Technology</b> · <a href="https://vedam.org" className="font-semibold text-accent">vedam.org</a></div>
          </div>
        )}
      </div>
    </div>
  );
}
