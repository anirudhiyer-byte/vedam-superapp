"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cx, vx } from "@/components/admin/ui/vx";

/**
 * VSAT coupon maker (admin, inside the Exam Center).
 *
 * Create flat/percent coupons for the ₹1000 VSAT fee, with a note (who it's for),
 * an on/off toggle, optional expiry window + max-uses, and a usage counter. Coupons
 * are entered MANUALLY by students at checkout — they are never shown on the checkout
 * page unless "visible at checkout" is ticked. All writes go through admin-only,
 * SECURITY DEFINER RPCs (vsat_coupon_*). The ₹200 24-hour auto-discount is separate
 * and is never stacked — a coupon merges with it (student gets the better of the two).
 */

type Coupon = {
  id: string; code: string; amount: number; discount_type: "flat" | "percent";
  note: string | null; active: boolean; valid_from: string | null; valid_to: string | null;
  max_uses: number | null; used_count: number; uses_left: number | null;
  visible_at_checkout: boolean; created_at: string;
};

const input = vx.input;
const label = vx.label;
const card = cx(vx.card, "p-5 sm:p-6");

const ERRORS: Record<string, string> = {
  missing_code: "Enter a code.", bad_amount: "Enter a value above 0.",
  code_exists: "That code already exists.", percent_over_100: "Percent can't exceed 100.",
  bad_max_uses: "Max uses must be above 0.", forbidden: "Admins only.",
};

function fmtDate(s: string | null) { return s ? new Date(s).toLocaleDateString() : "—"; }

export function VsatCouponMaker() {
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  // create form
  const [code, setCode] = useState("");
  const [dtype, setDtype] = useState<"flat" | "percent">("flat");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [validTo, setValidTo] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [visible, setVisible] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    const { data, error } = await supabase.rpc("vsat_coupon_list");
    setLoading(false);
    if (error) { setErr(error.message.includes("forbidden") ? "Admins only." : "Couldn't load coupons."); return; }
    setRows((data as Coupon[]) ?? []);
  }, [supabase]);
  useEffect(() => { void load(); }, [load]);

  async function create() {
    setErr(""); setMsg("");
    if (!code.trim()) return setErr("Enter a code.");
    if (!(Number(amount) > 0)) return setErr("Enter a value above 0.");
    setBusy(true);
    const { data, error } = await supabase.rpc("vsat_coupon_create", { p: {
      code: code.trim(), discount_type: dtype, amount: Number(amount),
      note: note.trim() || null, valid_to: validTo || null,
      max_uses: maxUses ? Number(maxUses) : null, visible_at_checkout: visible,
    } });
    setBusy(false);
    if (error) return setErr(error.message);
    if (!data?.ok) return setErr(ERRORS[data?.error] || data?.error || "Couldn't create the coupon.");
    setMsg(`Created ${code.trim().toUpperCase()}.`);
    setCode(""); setAmount(""); setNote(""); setValidTo(""); setMaxUses(""); setVisible(false); setDtype("flat");
    void load();
  }

  async function toggle(c: Coupon) {
    setErr(""); setBusy(true);
    const { data, error } = await supabase.rpc("vsat_coupon_update", { p: { id: c.id, active: !c.active } });
    setBusy(false);
    if (error || !data?.ok) return setErr("Couldn't update the coupon.");
    void load();
  }

  async function toggleVisible(c: Coupon) {
    setErr(""); setBusy(true);
    const { data, error } = await supabase.rpc("vsat_coupon_update", { p: { id: c.id, visible_at_checkout: !c.visible_at_checkout } });
    setBusy(false);
    if (error || !data?.ok) return setErr("Couldn't update the coupon.");
    void load();
  }

  async function remove(c: Coupon) {
    setErr("");
    if (c.used_count > 0) return setErr(`${c.code} has been used — deactivate it instead of deleting.`);
    if (!confirm(`Delete coupon ${c.code}?`)) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("vsat_coupon_delete", { p: { id: c.id } });
    setBusy(false);
    if (error || !data?.ok) return setErr(data?.error === "already_used" ? "Already used — deactivate instead." : "Couldn't delete the coupon.");
    void load();
  }

  return (
    <section className={`${card} mt-6`}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-vx-ink">Coupons</h2>
        <span className="text-xs text-vx-faint">Manual entry only · never shown at checkout unless marked visible</span>
      </div>

      {/* create */}
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-6">
        <div className="col-span-2 md:col-span-1">
          <label className={label}>Code</label>
          <input className={input} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="SAVE750" />
        </div>
        <div>
          <label className={label}>Type</label>
          <select className={input} value={dtype} onChange={(e) => setDtype(e.target.value as "flat" | "percent")}>
            <option value="flat">₹ flat</option>
            <option value="percent">% off</option>
          </select>
        </div>
        <div>
          <label className={label}>{dtype === "percent" ? "Percent" : "Amount ₹"}</label>
          <input className={input} type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={dtype === "percent" ? "50" : "750"} />
        </div>
        <div className="col-span-2 md:col-span-1">
          <label className={label}>Note (who it&apos;s for)</label>
          <input className={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Consultant – Mr. X" />
        </div>
        <div>
          <label className={label}>Expires (optional)</label>
          <input className={input} type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
        </div>
        <div>
          <label className={label}>Max uses (blank = ∞)</label>
          <input className={input} type="number" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="∞" />
        </div>
        <label className="col-span-2 flex items-center gap-2 text-xs text-vx-mut md:col-span-1">
          <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> Show at checkout
        </label>
        <div className="col-span-2 flex items-end md:col-span-1">
          <button onClick={create} disabled={busy} className={cx(vx.btn, vx.primary, "w-full")}>Create</button>
        </div>
      </div>
      {err && <p className="mt-3 text-xs font-semibold text-vx-red">{err}</p>}
      {msg && <p className="mt-3 text-xs font-semibold text-vx-green">{msg}</p>}

      {/* list */}
      <div className="mt-5 overflow-x-auto">
        {loading ? <p className="text-sm text-vx-faint">Loading…</p> : rows.length === 0 ? (
          <p className="text-sm text-vx-faint">No coupons yet.</p>
        ) : (
          <table className="w-full text-left text-sm text-vx-ink">
            <thead className="text-xs text-vx-faint">
              <tr><th className="py-2 pr-3">Code</th><th className="pr-3">Off</th><th className="pr-3">Note</th><th className="pr-3">Used</th><th className="pr-3">Expires</th><th className="pr-3">Checkout</th><th className="pr-3">Active</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-t border-vx-line">
                  <td className="py-2 pr-3 font-bold text-vx-ink">{c.code}</td>
                  <td className="pr-3 tabular-nums">{c.discount_type === "percent" ? `${c.amount}%` : `₹${c.amount}`}</td>
                  <td className="pr-3 text-vx-mut">{c.note || "—"}</td>
                  <td className="pr-3 tabular-nums">{c.used_count}{c.max_uses != null ? ` / ${c.max_uses}` : ""}</td>
                  <td className="pr-3">{fmtDate(c.valid_to)}</td>
                  <td className="pr-3">
                    <button onClick={() => toggleVisible(c)} disabled={busy} className={`rounded px-2 py-0.5 text-xs font-semibold ${c.visible_at_checkout ? "bg-vx-violet/20 text-vx-violet-t" : "bg-white/5 text-vx-faint"}`}>{c.visible_at_checkout ? "Shown" : "Hidden"}</button>
                  </td>
                  <td className="pr-3">
                    <button onClick={() => toggle(c)} disabled={busy} className={`rounded px-2 py-0.5 text-xs font-semibold ${c.active ? "bg-vx-green/20 text-vx-green" : "bg-white/5 text-vx-faint"}`}>{c.active ? "On" : "Off"}</button>
                  </td>
                  <td className="text-right">
                    <button onClick={() => remove(c)} disabled={busy} className="text-xs text-vx-faint hover:text-vx-red">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
