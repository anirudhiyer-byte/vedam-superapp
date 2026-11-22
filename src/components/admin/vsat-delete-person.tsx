"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cx, vx } from "@/components/admin/ui/vx";

/**
 * Admin-only hard-delete of a dummy / test VSAT person, straight from the VSAT Leads panel
 * (by lead_id) or the Applications student drawer (by application_id). Both call a SECURITY
 * DEFINER function (0141) that erases the whole VSAT footprint — lead, application, exam /
 * interview / counselling rows, payments, CRM logs and early registration — and logs the
 * deletion with per-table counts. The database re-checks is_admin() on every call; this UI is
 * only a convenience. Irreversible, so a typed "DELETE" confirmation is required.
 */

type Props = {
  kind: "lead" | "application";
  id: string;
  name?: string | null;
  email?: string | null;
  onDeleted: () => void;
  /** compact = small icon-style button for a table row; otherwise a full danger button. */
  compact?: boolean;
};

const CONFIRM_WORD = "DELETE";

export function DeletePerson({ kind, id, name, email, onDeleted, compact }: Props) {
  const [supabase] = useState(() => createClient());
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ total: number } | null>(null);

  const who = name?.trim() || email?.trim() || (kind === "lead" ? "this lead" : "this application");

  function reset() { setTyped(""); setErr(""); setBusy(false); setDone(null); }
  function close() { if (!busy) { setOpen(false); reset(); } }

  async function confirmDelete() {
    if (typed.trim().toUpperCase() !== CONFIRM_WORD) return;
    setBusy(true); setErr("");
    const fn = kind === "lead" ? "vsat_admin_delete_lead" : "vsat_admin_delete_application";
    const arg = kind === "lead" ? { p_lead_id: id } : { p_application_id: id };
    const { data, error } = await supabase.rpc(fn, arg);
    if (error) { setErr(humanError(error.message)); setBusy(false); return; }
    const counts = (data as { deleted?: Record<string, number> } | null)?.deleted ?? {};
    const total = Object.values(counts).reduce((a, b) => a + (Number(b) || 0), 0);
    setDone({ total });
    setBusy(false);
    // let the caller refresh its list / close its drawer
    setTimeout(() => { onDeleted(); }, 900);
  }

  return (
    <>
      {compact ? (
        <button
          type="button"
          className={cx(vx.btn, vx.danger, vx.sm)}
          onClick={(e) => { e.stopPropagation(); setOpen(true); }}
          aria-label={`Delete ${who}`}
          title="Delete this person (admin)"
        >
          Delete
        </button>
      ) : (
        <button type="button" className={cx(vx.btn, vx.danger)} onClick={() => setOpen(true)}>
          Delete this person
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm delete"
          onClick={close}
        >
          <div className={cx(vx.card, vx.pad, "w-full max-w-md")} onClick={(e) => e.stopPropagation()}>
            {done ? (
              <div className="space-y-4">
                <h3 className={vx.h2}>Deleted</h3>
                <p className={vx.note}>
                  Erased <b className="text-vx-ink">{who}</b> and their full VSAT footprint
                  {" "}({done.total} row{done.total === 1 ? "" : "s"} removed across all tables).
                </p>
                <div className="flex justify-end">
                  <button className={cx(vx.btn, vx.secondary)} onClick={close}>Close</button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <h3 className={vx.h2}>Delete this person?</h3>
                <p className={vx.note}>
                  This permanently erases <b className="text-vx-ink">{who}</b>
                  {email ? <> (<span className="font-mono text-[12px]">{email}</span>)</> : null} and everything
                  attached to them in VSAT — {kind === "lead" ? "their application, " : ""}exam, interview,
                  counselling, payments, CRM logs and early registration — as if they never existed.
                  It cannot be undone.
                </p>
                <div>
                  <label className={vx.label}>Type <span className="font-mono text-vx-ink">{CONFIRM_WORD}</span> to confirm</label>
                  <input
                    className={vx.input}
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    placeholder={CONFIRM_WORD}
                    autoFocus
                    disabled={busy}
                    aria-label="Type DELETE to confirm"
                  />
                </div>
                {err && <div className={vx.error}>{err}</div>}
                <div className="flex justify-end gap-2">
                  <button className={cx(vx.btn, vx.secondary)} onClick={close} disabled={busy}>Cancel</button>
                  <button
                    className={cx(vx.btn, vx.danger)}
                    onClick={confirmDelete}
                    disabled={busy || typed.trim().toUpperCase() !== CONFIRM_WORD}
                  >
                    {busy ? "Deleting…" : "Delete permanently"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function humanError(raw: string): string {
  if (/NOT_AUTHORISED/.test(raw)) return "Only admins can delete people.";
  if (/APPLICATION_NOT_FOUND/.test(raw)) return "That application no longer exists.";
  if (/write-once/.test(raw)) return "Could not remove the payment record. Please try again or contact an admin.";
  return raw;
}
