"use client";

/* Source-wise registrant split per product (ins_source_split, 0143). For the chosen product
   (and, for VSAT, a chosen exam), each marketing bucket's Registrations + MQR, with the derived
   %s: MQR-rate, % of registrations, % of MQR. Date window comes from the page's period control. */

import { useMemo, useState } from "react";
import { useRpc, type SourceSplit, type VsatExam } from "./data";
import { Card, Loading, ErrorNote, Empty, Segmented, ACCENT } from "./ui";

type Range = { p_from: string | null; p_to: string | null };

const PRODUCTS = [
  { key: "all", label: "Vedam One" },
  { key: "bootcamp", label: "Bootcamp" },
  { key: "codesprint", label: "CodeSprint" },
  { key: "pyq", label: "PYQ" },
  { key: "vsat_early", label: "VSAT Early Reg" },
  { key: "vsat_exam", label: "VSAT" },
] as const;
type Product = (typeof PRODUCTS)[number]["key"];

const pct = (n: number, d: number) => (d > 0 ? (100 * n) / d : 0);
const fp = (v: number) => `${v.toFixed(1)}%`;
const fmt = (n: number) => n.toLocaleString("en-IN");

export function SourceSplitTab({ range }: { range: Range }) {
  const [product, setProduct] = useState<Product>("all");
  const [vsat, setVsat] = useState<string>(""); // "" = All VSATs

  const vsats = useRpc<VsatExam[]>("ins_vsats", product === "vsat_exam" ? {} : null);
  const args = useMemo(
    () => ({ p_product: product, p_from: range.p_from, p_to: range.p_to, p_vsat: product === "vsat_exam" && vsat ? vsat : null }),
    [product, range.p_from, range.p_to, vsat],
  );
  const res = useRpc<SourceSplit>("ins_source_split", args);
  const d = res.data;

  const examOpts = vsats.data ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented value={product} onChange={(p) => { setProduct(p); setVsat(""); }} options={PRODUCTS.map((p) => ({ key: p.key, label: p.label }))} />
        {product === "vsat_exam" && (
          <select
            value={vsat}
            onChange={(e) => setVsat(e.target.value)}
            aria-label="Which VSAT"
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-[13px] text-white focus:border-[#8A18FF] focus:outline-none"
          >
            <option value="">All VSATs</option>
            {examOpts.map((x) => (
              <option key={x.id} value={x.id} className="bg-[#1a1530]">
                {x.label || x.exam_date || x.id.slice(0, 8)}
              </option>
            ))}
          </select>
        )}
      </div>

      <Card
        title="Source-wise registrant split"
        sub={
          d
            ? `${fmt(d.total_registrations)} registration${d.total_registrations === 1 ? "" : "s"} · ${fmt(d.total_mqr)} MQR · classified by primary (first-touch) campaign`
            : "By first-touch marketing source"
        }
      >
        {res.loading ? (
          <Loading />
        ) : res.error ? (
          <ErrorNote message={res.error} />
        ) : !d || d.rows.length === 0 ? (
          <Empty>No registrations in this window.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13.5px]">
              <thead className="text-[11.5px] uppercase tracking-wide text-white/45">
                <tr className="border-b border-white/10">
                  <th className="py-2.5 pr-3 font-medium">Source</th>
                  <th className="px-3 py-2.5 text-right font-medium">Registrations</th>
                  <th className="px-3 py-2.5 text-right font-medium">MQR</th>
                  <th className="px-3 py-2.5 text-right font-medium">MQR rate</th>
                  <th className="px-3 py-2.5 text-right font-medium">% of regs</th>
                  <th className="py-2.5 pl-3 text-right font-medium">% of MQR</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {d.rows.map((r) => {
                  const srcSplit = pct(r.registrations, d.total_registrations);
                  return (
                    <tr key={r.bucket} className="transition-colors hover:bg-white/[0.03]">
                      <td className="py-2.5 pr-3">
                        <span className="font-medium text-white/90">{r.bucket}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-white/85">{fmt(r.registrations)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-white/85">{fmt(r.mqr)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-white/55">{fp(pct(r.mqr, r.registrations))}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-2">
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/10">
                            <div className="h-full rounded-full" style={{ width: `${Math.min(100, srcSplit)}%`, background: ACCENT }} />
                          </div>
                          <span className="w-12 text-right tabular-nums text-white/70">{fp(srcSplit)}</span>
                        </div>
                      </td>
                      <td className="py-2.5 pl-3 text-right tabular-nums text-white/70">{fp(pct(r.mqr, d.total_mqr))}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-white/15 font-semibold text-white">
                  <td className="py-2.5 pr-3">Total</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmt(d.total_registrations)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmt(d.total_mqr)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-white/55">{fp(pct(d.total_mqr, d.total_registrations))}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-white/70">100.0%</td>
                  <td className="py-2.5 pl-3 text-right tabular-nums text-white/70">100.0%</td>
                </tr>
              </tfoot>
            </table>
            <p className="mt-3 text-[11.5px] leading-relaxed text-white/40">
              Buckets: Meta &amp; Google (paid, split by medium), Telegram, WhatsApp (incl. community), Website
              (vedam.org CTAs), Email, School Connect, Influencers (YT/IG), Direct/Unknown, Other. Test data and
              internal @vedam emails are excluded. MQR = PCM/PCMB &amp; passing 2026–27.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
