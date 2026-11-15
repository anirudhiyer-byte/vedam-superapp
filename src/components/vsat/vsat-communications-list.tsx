"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";

type CommItem = { id: string; channel: "email" | "whatsapp"; title: string; kind: string | null; status: string | null; at: string; has_body: boolean };

const card = "rounded-2xl border border-[#e9e4f2] bg-white p-5 shadow-[0_10px_30px_-22px_rgba(43,19,92,0.38)]";
const iconTint = "grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[#f2ebfd] text-base";

/** Standalone "My communications" page — every email + WhatsApp we've sent the student.
 *  Emails open their saved content inline (sandboxed); WhatsApp shows status only. */
export function VsatCommunicationsList() {
  const [supabase] = useState(() => createClient());
  const [comms, setComms] = useState<CommItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [emailBody, setEmailBody] = useState<{ subject: string; html: string } | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setLoading(false); return; }
      try {
        const { data } = await supabase.rpc("vsat_my_communications", { p_limit: 100 });
        if (data?.ok) setComms((data.items as CommItem[]) ?? []);
      } catch { /* best-effort */ }
      setLoading(false);
    })();
  }, [supabase]);

  async function openEmail(id: string) {
    const { data } = await supabase.rpc("vsat_my_email_body", { p_id: id });
    if (data?.ok) setEmailBody({ subject: data.subject || "Email", html: data.html || "" });
  }

  return (
    <div className="min-h-screen bg-[#f6f4fa] text-[#1b1030]">
      <div className="mx-auto max-w-[760px] px-4 py-5">
        <div className="mb-4 flex items-center justify-between">
          <Image src="/vedam-logo.png" alt="Vedam School of Technology" width={200} height={70} className="h-8 w-auto" priority />
          <Link href="/apply/dashboard" className="inline-flex items-center gap-2 rounded-[10px] border border-[#e9e4f2] bg-white px-3.5 py-2 text-sm font-semibold text-[#1b1030] transition hover:border-[#8a18ff]">← Dashboard</Link>
        </div>

        <section className={card}>
          <h1 className="font-display text-[19px] font-extrabold">My communications</h1>
          <p className="mt-1 text-sm text-[#6c6485]">Every email and WhatsApp message we&apos;ve sent you.</p>
          <div className="mt-4 flex flex-col gap-2.5">
            {loading ? (
              <div className="py-8 text-center text-[13px] text-[#a79fbd]">Loading…</div>
            ) : comms.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#e9e4f2] px-3.5 py-8 text-center text-[13px] text-[#a79fbd]">No communications yet. Emails and WhatsApp messages we send you will show up here.</div>
            ) : comms.map((c) => {
              const dt = new Date(c.at).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
              return (
                <div key={`${c.channel}-${c.id}`} className="flex items-center gap-3 rounded-xl border border-[#e9e4f2] p-3.5">
                  <span className={iconTint}>{c.channel === "email" ? "✉️" : "💬"}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-display text-[14px] font-bold">{c.title}</div>
                    <div className="text-xs text-[#6c6485]">{c.channel === "email" ? "Email" : "WhatsApp"} · {dt}{c.status ? ` · ${c.status}` : ""}</div>
                  </div>
                  {c.channel === "email" && c.has_body && (
                    <button onClick={() => openEmail(c.id)} className="shrink-0 rounded-lg border border-[#e9e4f2] px-2.5 py-1 text-[12px] font-semibold text-[#8a18ff] transition hover:border-[#8a18ff]">View</button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {emailBody && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setEmailBody(null)}>
          <div className="flex max-h-[85vh] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-[#e9e4f2] px-4 py-3">
              <h3 className="truncate font-display text-sm font-bold">{emailBody.subject}</h3>
              <button onClick={() => setEmailBody(null)} aria-label="Close" className="shrink-0 text-lg leading-none text-[#6c6485] hover:text-[#1b1030]">✕</button>
            </div>
            <iframe title="Email" sandbox="" srcDoc={emailBody.html} className="h-[70vh] w-full border-0 bg-white" />
          </div>
        </div>
      )}
    </div>
  );
}
