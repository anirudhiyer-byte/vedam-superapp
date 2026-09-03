"use client";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { renderEmailTemplateHtml } from "@/lib/email/render";
import { EMAIL_TEMPLATES } from "@/lib/email/shell";

type Btn = { label: string; url: string };
type Product = "events" | "codesprint" | "college_predictor" | "general";

export function EmailTemplateComposer({ product, onSaved }: { product: Product; onSaved?: () => void }) {
  const [supabase] = useState(() => createClient());
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [style, setStyle] = useState("brand");
  const [image, setImage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [buttons, setButtons] = useState<Btn[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const html = useMemo(() => renderEmailTemplateHtml({ subject, message, template_style: style, image, buttons }), [subject, message, style, image, buttons]);

  async function upload(file: File) {
    setUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const path = `email-tpl/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("email-images").upload(path, file, { upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from("email-images").getPublicUrl(path); setImage(data.publicUrl);
    } catch { /* */ } finally { setUploading(false); }
  }
  async function save() {
    setMsg(null);
    if (!name.trim() || !subject.trim() || !message.trim()) return setMsg("Name, subject and message are required.");
    setSaving(true);
    const { error } = await supabase.from("email_templates").insert({ name: name.trim(), subject: subject.trim(), message, template_style: style, image: image || null, buttons, product: product === "general" ? "general" : product });
    setSaving(false);
    if (error) return setMsg(error.message);
    setMsg("Email template saved."); setName(""); setSubject(""); setMessage(""); setImage(""); setButtons([]); onSaved?.();
  }

  const field = "w-full rounded-lg border border-border-strong bg-background px-3 py-2.5 text-sm text-foreground outline-none";
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px] lg:items-start">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="mb-1 block font-body text-xs font-semibold">Template name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Recording follow-up" className={field} /></label>
          <label className="block"><span className="mb-1 block font-body text-xs font-semibold">Background style</span><select value={style} onChange={(e) => setStyle(e.target.value)} className={field}>{EMAIL_TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></label>
        </div>
        <label className="block"><span className="mb-1 block font-body text-xs font-semibold">Subject</span><input value={subject} onChange={(e) => setSubject(e.target.value)} className={field} /></label>
        <div>
          <span className="mb-1 block font-body text-xs font-semibold">Top image (optional)</span>
          <div className="flex flex-wrap items-center gap-2">
            <label className="cursor-pointer rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm font-semibold hover:bg-surface-warm">{uploading ? "Uploading…" : "Upload"}<input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} /></label>
            <input value={image} onChange={(e) => setImage(e.target.value)} placeholder="or paste URL" className={field + " flex-1"} />
          </div>
        </div>
        <label className="block"><span className="mb-1 block font-body text-xs font-semibold">Message</span><textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={6} placeholder={"Hi {{name}},\n\n…"} className={field + " font-mono"} /></label>
        <div>
          <div className="mb-1 flex items-center justify-between"><span className="font-body text-xs font-semibold">Buttons</span><button onClick={() => setButtons((b) => [...b, { label: "", url: "" }])} className="font-mono text-xs text-accent">+ add</button></div>
          {buttons.map((b, i) => (
            <div key={i} className="mb-2 flex gap-2">
              <input value={b.label} onChange={(e) => setButtons((bs) => bs.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} placeholder="Label" className={field} />
              <input value={b.url} onChange={(e) => setButtons((bs) => bs.map((x, j) => j === i ? { ...x, url: e.target.value } : x))} placeholder="https://…" className={field} />
              <button onClick={() => setButtons((bs) => bs.filter((_, j) => j !== i))} className="rounded-lg border border-border px-3 font-mono text-xs text-muted">✕</button>
            </div>
          ))}
        </div>
        {msg && <p className="font-body text-sm text-foreground">{msg}</p>}
        <button onClick={save} disabled={saving} className="rounded-xl bg-brand-gradient px-6 py-3 text-sm font-semibold text-white disabled:opacity-60">{saving ? "Saving…" : `Save email template (${product})`}</button>
      </div>
      <div className="lg:sticky lg:top-20">
        <span className="mb-1.5 block font-mono text-xs font-semibold uppercase tracking-wide text-muted">Live preview (branded)</span>
        <iframe title="Email preview" srcDoc={html} className="h-[520px] w-full rounded-2xl border border-border bg-white" />
      </div>
    </div>
  );
}
