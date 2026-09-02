"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Btn = { type: "URL" | "QUICK_REPLY"; text: string; url?: string };
type HeaderType = "none" | "text" | "image" | "document";
type Tpl = { id?: string; name?: string; status?: string; temp_error?: string; jsonstruct?: string; placeholder?: { bodyvar?: number } };

const LANGS = [["en", "English"], ["en_US", "English (US)"], ["hi", "Hindi"]];
const CATS = ["MARKETING", "UTILITY", "AUTHENTICATION"];
const isShareLink = (u: string) => /drive\.google|dropbox\.com\/s|1drv\.ms|docs\.google/i.test(u);

// Meta validation of the body text
function validateBody(body: string): string[] {
  const errs: string[] = [];
  const t = body.trim();
  if (!t) return ["Body can't be empty."];
  if (/^\s*\{\{/.test(t)) errs.push("Body can't start with a variable — add fixed text before {{1}}.");
  if (/\}\}\s*$/.test(t)) errs.push("Body can't end with a variable — add fixed text after the last variable.");
  if (/\}\}\s*\{\{/.test(t)) errs.push("Two variables can't be next to each other — put text between them.");
  const nums = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  if (nums.length) {
    const uniq = [...new Set(nums)].sort((a, b) => a - b);
    const expected = uniq.map((_, i) => i + 1);
    if (JSON.stringify(uniq) !== JSON.stringify(expected)) errs.push("Variables must be numbered sequentially starting at {{1}} (no gaps, no {{0}}).");
  }
  if (body.length > 1024) errs.push("Body is over 1024 characters.");
  return errs;
}

export function WhatsAppTemplateBuilder() {
  const [supabase] = useState(() => createClient());
  const [tpls, setTpls] = useState<Tpl[]>([]);

  // form
  const [name, setName] = useState("");
  const [lang, setLang] = useState("en");
  const [category, setCategory] = useState("MARKETING");
  const [headerType, setHeaderType] = useState<HeaderType>("none");
  const [headerText, setHeaderText] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [body, setBody] = useState("");
  const [samples, setSamples] = useState<string[]>([]);
  const [footer, setFooter] = useState("");
  const [buttons, setButtons] = useState<Btn[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [resp, setResp] = useState<string | null>(null);

  async function loadTpls() {
    try { const r = await fetch("/api/whatsapp/templates"); const j = await r.json(); const raw = j?.data;
      const list = Array.isArray(raw) ? raw : Array.isArray(raw?.templates) ? raw.templates : Array.isArray(raw?.data) ? raw.data : [];
      setTpls(list as Tpl[]); } catch { /* */ }
  }
  useEffect(() => { loadTpls(); }, []);

  const varCount = useMemo(() => { const n = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])); return n.length ? Math.max(...n) : 0; }, [body]);
  useEffect(() => { setSamples((s) => Array.from({ length: varCount }, (_, i) => s[i] || "")); }, [varCount]);

  const bodyErrs = useMemo(() => validateBody(body), [body]);
  const urlBtns = buttons.filter((b) => b.type === "URL").length;
  const qrBtns = buttons.filter((b) => b.type === "QUICK_REPLY").length;
  const canSubmit = !!name.trim() && bodyErrs.length === 0 && samples.every((s) => s.trim()) &&
    (headerType !== "image" && headerType !== "document" ? true : !!mediaUrl.trim());

  function insertVar() { setBody((b) => `${b}{{${varCount + 1}}}`); }
  function duplicate(t: Tpl) {
    try {
      const j = JSON.parse(t.jsonstruct || "{}");
      setName((t.name || "template").replace(/_[a-z0-9]{10,}$/i, "") + "_copy");
      if (j.header) { setHeaderType(j.header.format === "TEXT" ? "text" : j.header.format === "DOCUMENT" ? "document" : "image"); setHeaderText(j.header.text || ""); setMediaUrl(j.header.url || ""); }
      else setHeaderType("none");
      setBody(j.body?.text || "");
      setFooter(j.footer?.text || "");
      setButtons((j.buttons?.buttons || []).map((b: { type: string; text: string; url?: string }) => ({ type: b.type === "URL" ? "URL" : "QUICK_REPLY", text: b.text, url: b.url })));
    } catch { /* */ }
  }

  async function upload(file: File) {
    setUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const path = `wa-template/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("email-images").upload(path, file, { upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from("email-images").getPublicUrl(path);
      setMediaUrl(data.publicUrl);
    } catch { /* */ } finally { setUploading(false); }
  }

  function buildPayload() {
    const components: Record<string, unknown>[] = [];
    if (headerType === "text" && headerText.trim()) components.push({ type: "HEADER", format: "TEXT", text: headerText.trim() });
    if (headerType === "image") components.push({ type: "HEADER", format: "IMAGE", example: { header_handle: [mediaUrl] } });
    if (headerType === "document") components.push({ type: "HEADER", format: "DOCUMENT", example: { header_handle: [mediaUrl] } });
    const bodyComp: Record<string, unknown> = { type: "BODY", text: body };
    if (samples.length) bodyComp.example = { body_text: [samples] };
    components.push(bodyComp);
    if (footer.trim()) components.push({ type: "FOOTER", text: footer.trim() });
    if (buttons.length) components.push({ type: "BUTTONS", buttons: buttons.map((b) => b.type === "URL" ? { type: "URL", text: b.text, url: b.url } : { type: "QUICK_REPLY", text: b.text }) });
    const payload: Record<string, unknown> = { name: name.trim(), lang, category, components };
    if (headerType === "image" || headerType === "document") payload.media = { header: mediaUrl };
    return payload;
  }

  async function submit() {
    setSubmitting(true); setResp(null);
    try {
      const r = await fetch("/api/whatsapp/create-template", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(buildPayload()) });
      const j = await r.json(); setResp(JSON.stringify(j, null, 2));
      loadTpls();
    } catch (e) { setResp(String(e)); }
    setSubmitting(false);
  }

  const field = "w-full rounded-lg border border-border-strong bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-[color:rgb(var(--accent))]";
  const seg = (on: boolean) => ["rounded-md px-3 py-1.5 text-xs font-bold", on ? "bg-surface text-foreground shadow-sm" : "text-muted"].join(" ");

  // preview body with samples
  const previewBody = body.replace(/\{\{(\d+)\}\}/g, (_, n) => samples[Number(n) - 1] || `{{${n}}}`);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <span className="font-mono text-xs font-semibold lowercase tracking-[0.12em] text-accent">// whatsapp · template builder</span>
      <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-heading">Create WhatsApp template</h1>

      {/* duplicate */}
      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-border-strong bg-[linear-gradient(120deg,#fdf3ec,#f3ecfb)] p-4">
        <span className="text-xl">📋</span>
        <div className="flex-1"><div className="font-display text-sm font-extrabold text-heading">Duplicate an existing template</div>
          <div className="font-body text-xs text-muted">Copies header, body, footer, buttons &amp; variables — then rename &amp; tweak.</div></div>
        <select onChange={(e) => { const t = tpls.find((x) => (x.name || x.id) === e.target.value); if (t) duplicate(t); }} defaultValue="" className={field + " max-w-xs"}>
          <option value="">Pick a template…</option>
          {tpls.filter((t) => t.jsonstruct).map((t, i) => <option key={i} value={t.name || t.id}>{t.name}{t.status ? ` · ${t.status}` : ""}</option>)}
        </select>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_360px] lg:items-start">
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="block sm:col-span-1"><span className="mb-1.5 block font-body text-xs font-semibold text-foreground">Name</span><input value={name} onChange={(e) => setName(e.target.value.replace(/[^a-z0-9_]/g, "_").toLowerCase())} placeholder="event_reminder" className={field} /></label>
              <label className="block"><span className="mb-1.5 block font-body text-xs font-semibold text-foreground">Language</span><select value={lang} onChange={(e) => setLang(e.target.value)} className={field}>{LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              <label className="block"><span className="mb-1.5 block font-body text-xs font-semibold text-foreground">Category</span><select value={category} onChange={(e) => setCategory(e.target.value)} className={field}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></label>
            </div>
          </div>

          {/* header */}
          <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="mb-2 font-display text-sm font-bold text-heading">Header <span className="font-normal text-muted">(optional)</span></div>
            <div className="inline-flex gap-1 rounded-lg bg-surface-warm p-1">
              {(["none", "text", "image", "document"] as HeaderType[]).map((h) => <button key={h} onClick={() => setHeaderType(h)} className={seg(headerType === h)}>{h[0].toUpperCase() + h.slice(1)}</button>)}
            </div>
            {headerType === "text" && <input value={headerText} onChange={(e) => setHeaderText(e.target.value.slice(0, 60))} placeholder="Header text (max 60)" className={field + " mt-2"} />}
            {(headerType === "image" || headerType === "document") && (
              <div className="mt-2">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="cursor-pointer rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm font-semibold hover:bg-surface-warm">{uploading ? "Uploading…" : "Upload file"}<input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} /></label>
                  <span className="font-mono text-xs text-muted">or paste a direct URL:</span>
                  <input value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} placeholder="https://…/banner.jpg" className={field + " flex-1"} />
                </div>
                {mediaUrl && isShareLink(mediaUrl) && <p className="mt-1 font-body text-xs text-amber-600">⚠️ That looks like a Drive/Dropbox share link — WhatsApp can't fetch those. Upload the file instead or use a direct file URL.</p>}
              </div>
            )}
          </div>

          {/* body */}
          <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="mb-2 flex items-center justify-between"><span className="font-display text-sm font-bold text-heading">Body</span>
              <button onClick={insertVar} className="rounded-md border border-dashed border-[color:rgb(var(--accent))] bg-surface-warm px-2.5 py-1 font-mono text-xs font-bold text-accent">+ {`{{${varCount + 1}}}`}</button></div>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="Hi {{1}}, reminder: {{2}} starts at {{3}}. See you there!" className={field + " font-mono"} />
            {bodyErrs.length > 0 ? (
              <div className="mt-2 rounded-lg border border-red-300 bg-red-50 p-2.5 font-body text-xs text-red-600"><b>Fix before submitting:</b><ul className="mt-1 list-disc pl-4">{bodyErrs.map((e, i) => <li key={i}>{e}</li>)}</ul></div>
            ) : body.trim() && <div className="mt-2 rounded-lg border border-[#b7e4c7] bg-[#eafaf0] p-2.5 font-body text-xs text-[#12703f]"><b>✓ Valid.</b> No variable at start/end, numbered sequentially.</div>}
            {varCount > 0 && (
              <div className="mt-3"><span className="mb-1 block font-body text-xs font-semibold text-foreground">Sample values <span className="font-normal text-muted">(required for approval)</span></span>
                <div className="grid grid-cols-2 gap-2">{samples.map((s, i) => <input key={i} value={s} onChange={(e) => setSamples((sm) => sm.map((x, j) => j === i ? e.target.value : x))} placeholder={`{{${i + 1}}}`} className={field} />)}</div></div>
            )}
          </div>

          {/* footer */}
          <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="mb-2 font-display text-sm font-bold text-heading">Footer <span className="font-normal text-muted">(optional)</span></div>
            <input value={footer} onChange={(e) => setFooter(e.target.value.slice(0, 60))} placeholder="Vedam School of Technology" className={field} />
          </div>

          {/* buttons */}
          <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="mb-2 font-display text-sm font-bold text-heading">Buttons <span className="font-normal text-muted">(optional)</span></div>
            <div className="space-y-2">
              {buttons.map((b, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted">{b.type === "URL" ? "🔗" : "💬"}</span>
                  <input value={b.text} onChange={(e) => setButtons((bs) => bs.map((x, j) => j === i ? { ...x, text: e.target.value.slice(0, 25) } : x))} placeholder="Button text" className={field + " max-w-[160px]"} />
                  {b.type === "URL" && <input value={b.url || ""} onChange={(e) => setButtons((bs) => bs.map((x, j) => j === i ? { ...x, url: e.target.value } : x))} placeholder="https://…" className={field + " flex-1"} />}
                  <button onClick={() => setButtons((bs) => bs.filter((_, j) => j !== i))} className="font-mono text-xs text-muted">✕</button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-3">
              <button disabled={urlBtns >= 2} onClick={() => setButtons((b) => [...b, { type: "URL", text: "", url: "" }])} className="font-mono text-xs text-accent disabled:opacity-40">+ URL button</button>
              <button disabled={qrBtns >= 3} onClick={() => setButtons((b) => [...b, { type: "QUICK_REPLY", text: "" }])} className="font-mono text-xs text-accent disabled:opacity-40">+ Quick reply</button>
            </div>
            <p className="mt-1 font-body text-xs text-muted">Limits: up to 2 URL buttons, up to 3 quick-reply buttons.</p>
          </div>
        </div>

        {/* preview + submit */}
        <div className="lg:sticky lg:top-20">
          <span className="mb-1.5 block font-mono text-xs font-semibold uppercase tracking-wide text-muted">Live preview</span>
          <div className="rounded-2xl border border-border bg-[#E5DDD5] p-3">
            <div className="overflow-hidden rounded-xl bg-white shadow-sm">
              {headerType === "image" && <div className="grid h-28 place-items-center bg-brand-gradient text-xs font-bold text-white">{mediaUrl ? "🖼️ image header" : "image header"}</div>}
              {headerType === "text" && headerText && <div className="px-3 pt-2.5 font-display text-sm font-extrabold text-heading">{headerText}</div>}
              <div className="whitespace-pre-wrap px-3 py-2 text-[13.5px] leading-relaxed text-[#111]">{previewBody || <span className="text-muted">Your message preview…</span>}</div>
              {footer && <div className="px-3 pb-2 text-[11px] text-[#888]">{footer}</div>}
              {buttons.length > 0 && <div className="border-t border-[#eee]">{buttons.map((b, i) => <div key={i} className="border-t border-[#f0f0f0] py-2 text-center text-[13px] font-bold text-[#0a8] first:border-t-0">{b.type === "URL" ? "🔗 " : "💬 "}{b.text || "Button"}</div>)}</div>}
            </div>
          </div>
          {resp && <pre className="mt-3 max-h-48 overflow-auto rounded-xl border border-border bg-[#0e0a1c] p-3 font-mono text-xs text-[#c7f0d8]">{resp}</pre>}
          <button onClick={submit} disabled={!canSubmit || submitting} className="mt-3 w-full rounded-xl bg-brand-gradient px-6 py-3 text-sm font-semibold text-white disabled:opacity-50">{submitting ? "Submitting…" : "Submit for approval"}</button>
          <p className="mt-2 font-body text-xs text-muted">Goes to WhatsApp for approval. Track status below once submitted.</p>
        </div>
      </div>

      {/* status tracker */}
      <div className="mt-8">
        <span className="mb-2 block font-mono text-xs font-semibold uppercase tracking-wide text-muted">Your templates</span>
        <div className="space-y-2">
          {tpls.slice(0, 25).map((t, i) => {
            const st = (t.status || "").toUpperCase();
            const cls = st === "APPROVED" ? "bg-[#eafaf0] text-[#12703f]" : st === "FAILED" ? "bg-red-50 text-red-600" : "bg-[#fff6ec] text-[#7a5a2a]";
            return (
              <div key={i} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-2.5">
                <span className="flex-1 font-body text-sm font-semibold text-heading">{t.name}</span>
                <span className={"rounded-full px-2.5 py-1 font-mono text-[10px] font-bold " + cls}>{st || "—"}</span>
                {st === "FAILED" && t.temp_error && t.temp_error !== "NONE" && <span className="w-full font-body text-xs text-red-500 sm:w-auto">{t.temp_error}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
