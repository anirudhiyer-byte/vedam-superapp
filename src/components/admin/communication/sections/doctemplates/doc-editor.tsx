"use client";

/**
 * Slice 4 · Create / Edit Document Template (live). A plain textarea for the HTML.
 * "Check and preview" sends the text to the server, which cleans it (safe HTML subset) and lets the database
 * run every check without saving. The page then shows what was removed, the merge fields used, the cleaned
 * HTML (as text) and a preview in a sandboxed iframe filled with FAKE sample data. No dangerouslySetInnerHTML
 * anywhere: the HTML is only ever rendered inside the sandboxed iframe (srcdoc + CSP default-src 'none').
 */
import { useEffect, useState } from "react";
import { Button, Drawer, Icon, TextArea, TextField } from "../../ui/primitives";
import { Field } from "../../ui/form";
import { InlineError } from "../../ui/states";
import { DOC_MAX_BYTES, MERGE_FIELDS, byteLength, nameOk, scanMergeFields } from "@/lib/comm/doc-template-rules";
import { docTemplatesApi, fmtSize, type CheckResult } from "../../lib/live-doc-templates";
import { PREVIEW_SANDBOX, buildPreviewDoc } from "../../lib/doc-preview";

const STARTER = "<h2>Offer letter</h2>\n<p>Dear {{full_name}},</p>\n<p>Your VSAT ID is {{vsat_id}}. Campus: {{campus}}.</p>\n<p>Date: {{today}}</p>";

function removedText(r: CheckResult["removed"]): string {
  const parts = [
    r.tags && `${r.tags} tag${r.tags === 1 ? "" : "s"}`,
    r.handlers && `${r.handlers} event handler${r.handlers === 1 ? "" : "s"}`,
    r.attributes && `${r.attributes} attribute${r.attributes === 1 ? "" : "s"}`,
    r.styles && `${r.styles} style rule${r.styles === 1 ? "" : "s"}`,
    r.comments && `${r.comments} comment${r.comments === 1 ? "" : "s"}`,
  ].filter(Boolean);
  return parts.length ? `Removed: ${parts.join(", ")}.` : "Nothing was removed.";
}

export function DocTemplateEditor({ id, onClose, onSaved }: {
  id: string | null; onClose: () => void; onSaved: (name: string, edited: boolean) => void;
}) {
  const edit = id !== null;
  const [name, setName] = useState("");
  const [html, setHtml] = useState(edit ? "" : STARTER);
  const [loadedHtml, setLoadedHtml] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(edit);
  const [check, setCheck] = useState<(CheckResult & { for: string }) | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    docTemplatesApi.get(id)
      .then((t) => { if (!alive) return; setName(t.name); setHtml(t.html); setLoadedHtml(t.html); })
      .catch((e) => { if (alive) setLoadError(e instanceof Error ? e.message : "Could not load the template."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id]);

  const bytes = byteLength(html);
  const local = scanMergeFields(html);
  const checkedNow = !!check && check.for === html;
  const htmlChanged = !edit || html !== loadedHtml;
  const canSave = !saving && !loading && !loadError && nameOk(name) && (!htmlChanged || checkedNow);

  const runCheck = async () => {
    setError(null); setChecking(true);
    try { setCheck({ ...(await docTemplatesApi.check(html, name)), for: html }); }
    catch (e) { setCheck(null); setError(e instanceof Error ? e.message : "Could not check the template. Try again."); }
    finally { setChecking(false); }
  };

  const save = async () => {
    if (!nameOk(name)) { setNameError("Give the template a name (1–80 characters)."); return; }
    setNameError(null); setError(null); setSaving(true);
    try {
      if (edit && id) await docTemplatesApi.update(id, htmlChanged ? { name, html } : { name });
      else await docTemplatesApi.create(name, html);
      onSaved(name.trim(), edit);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save. Try again."); }
    finally { setSaving(false); }
  };

  return (
    <Drawer open accessible size="lg" title={edit ? "Edit Document Template" : "Create Document Template"} onClose={onClose}
      footer={
        <>
          <Button variant="ghost" touch onClick={onClose}>Cancel</Button>
          <Button variant="solid" touch icon="check" disabled={!canSave} onClick={save}>{saving ? "Saving…" : "Save template"}</Button>
        </>
      }>
      {loading && <p className="font-body text-sm text-muted">Loading the template…</p>}
      {loadError && <p role="alert" className="font-body text-sm text-[#f87171]">{loadError}</p>}
      {!loading && !loadError && (
        <div className="grid gap-4">
          <Field id="dt-name" label="Template name" required stacked error={nameError ?? undefined}>
            <TextField id="dt-name" touch placeholder="e.g. Offer letter" value={name} maxLength={80}
              invalid={!!nameError} describedBy={nameError ? "dt-name-error" : undefined}
              onChange={(v) => { setName(v); if (nameError) setNameError(null); }} />
          </Field>

          <Field id="dt-html" label="HTML" required stacked hint={`${fmtSize(bytes)} of 100 KB`}>
            <TextArea id="dt-html" touch rows={12} placeholder="<p>Dear {{full_name}},</p>" value={html}
              invalid={bytes > DOC_MAX_BYTES || local.unknown.length > 0} describedBy="dt-html-help"
              onChange={(v) => { setHtml(v); setError(null); }} />
            <p id="dt-html-help" className="font-body text-xs text-muted">
              Allowed: headings, paragraphs, bold / italic / underline, lists, tables, line breaks, simple alignment and spacing.
              Links, images and scripts are removed. Merge fields: {MERGE_FIELDS.map((f) => `{{${f}}}`).join(" ")}.
            </p>
            {bytes > DOC_MAX_BYTES && <InlineError>The template is over 100 KB.</InlineError>}
            {local.unknown.length > 0 && (
              <InlineError>Not an allowed merge field: {local.unknown.map((u) => (u.startsWith("unmatched") || u.startsWith("triple") ? u : `{{${u}}}`)).join(", ")}</InlineError>
            )}
          </Field>

          <div className="flex flex-wrap items-center gap-2">
            <Button touch icon="eye" disabled={checking || !html.trim() || bytes > DOC_MAX_BYTES} onClick={runCheck}>
              {checking ? "Checking…" : "Check and preview"}
            </Button>
            {htmlChanged && !checkedNow && <span className="font-body text-xs text-muted">Check the HTML before saving.</span>}
          </div>
          {error && <p role="alert" className="flex items-start gap-1.5 font-body text-sm font-semibold text-[#f87171]"><Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></p>}

          {check && (
            <section aria-label="Check result" className={`grid gap-3 rounded-xl border border-border p-3 ${checkedNow ? "" : "opacity-60"}`}>
              {!checkedNow && <p className="font-body text-xs font-semibold text-[#fbbf24]">The HTML changed after this check. Check again.</p>}
              <p className="font-body text-sm text-foreground" data-testid="dt-removed">{removedText(check.removed)}</p>
              {Object.keys(check.removed.byTag).length > 0 && (
                <p className="break-words font-body text-xs text-muted">Removed tags: {Object.entries(check.removed.byTag).map(([t, n]) => `<${t}>${n > 1 ? ` ×${n}` : ""}`).join(", ")}</p>
              )}
              <p className="font-body text-xs text-muted">
                Merge fields used: {check.mergeFields.length ? check.mergeFields.map((f) => `{{${f}}}`).join(", ") : "none"} · Size after cleaning: {fmtSize(check.size)}
              </p>
              <div>
                <p className="mb-1.5 font-body text-xs font-semibold text-heading">Preview (sample data: Test Student, VSAT-TEST-0001, Test Campus)</p>
                <iframe title="Template preview with sample data" sandbox={PREVIEW_SANDBOX} srcDoc={buildPreviewDoc(check.html)}
                  referrerPolicy="no-referrer" loading="lazy" className="h-72 w-full rounded-lg border border-border bg-white" />
              </div>
              <details>
                <summary className="cursor-pointer font-body text-xs font-semibold text-heading">Cleaned HTML (this is what will be saved)</summary>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-background p-2 font-mono text-[11px] text-foreground">{check.html}</pre>
              </details>
            </section>
          )}
        </div>
      )}
    </Drawer>
  );
}
