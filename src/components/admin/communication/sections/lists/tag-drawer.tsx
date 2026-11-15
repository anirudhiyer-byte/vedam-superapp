"use client";

import { useState } from "react";
import { Drawer, Button, TextField, Icon } from "../../ui/primitives";
import { Field } from "../../ui/form";
import { InlineError } from "../../ui/states";
import { listsApi } from "../../lib/mock-api";
import type { ListRow } from "../../lib/types";

const MAX_TAGS = 10;
const MAX_LEN = 30;
const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : "We could not save the tags. Please try again.");

/**
 * "Add Tag" drawer for one list: add and remove tags, then save them together.
 * The body mounts fresh every time it opens, so it never shows the previous session's edits.
 */
export function TagDrawer({ list, onClose, onSaved }: {
  list: ListRow | null; onClose: () => void; onSaved: (message: string) => void;
}) {
  return list ? <TagDrawerBody key={list.id} list={list} onClose={onClose} onSaved={onSaved} /> : null;
}

function TagDrawerBody({ list, onClose, onSaved }: { list: ListRow; onClose: () => void; onSaved: (message: string) => void }) {
  const [tags, setTags] = useState<string[]>(list.tags ?? []);
  const [text, setText] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const original = list.tags ?? [];
  const dirty = tags.join("|") !== original.join("|");

  const add = () => {
    const t = text.trim();
    if (!t) { setFieldError("Type a tag name first."); return; }
    if (/[,;]/.test(t)) { setFieldError("Use one tag at a time, without commas."); return; }
    if (tags.some((x) => x.toLowerCase() === t.toLowerCase())) { setFieldError("This tag is already on the list."); return; }
    if (tags.length >= MAX_TAGS) { setFieldError(`A list can have up to ${MAX_TAGS} tags.`); return; }
    setTags([...tags, t]); setText(""); setFieldError(null);
  };

  const save = async () => {
    if (pending || !dirty) return;
    setPending(true); setSubmitError(null);
    try {
      await listsApi.setTags(list.id, tags);
      onSaved(tags.length ? `Tags saved for “${list.name}”` : `Tags removed from “${list.name}”`);
      onClose();
    } catch (e) {
      setSubmitError(errText(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <Drawer open title="Add Tag" accessible onClose={onClose}
      footer={
        <>
          <Button variant="ghost" touch disabled={pending} onClick={onClose}>Cancel</Button>
          <Button variant="solid" touch disabled={pending || !dirty} onClick={save}>{pending ? "Saving…" : "Save tags"}</Button>
        </>
      }>
      <p className="font-body text-sm text-muted">
        Tags for <span className="font-semibold text-foreground">{list.name}</span>
        <span className="font-mono text-xs"> · ID {list.id}</span>. Use them to find lists by source or campaign.
      </p>

      <Field id="tag-new" label="New tag" hint={`(up to ${MAX_LEN} characters)`} error={fieldError ?? undefined} stacked>
        <div className="flex gap-2">
          <div className="min-w-0 flex-1" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}>
            <TextField id="tag-new" touch placeholder="e.g. pune-expo" maxLength={MAX_LEN} value={text}
              invalid={!!fieldError} describedBy={fieldError ? "tag-new-error" : undefined}
              onChange={(v) => { setText(v); if (fieldError) setFieldError(null); }} />
          </div>
          <Button touch icon="plus" onClick={add}>Add</Button>
        </div>
      </Field>

      <div>
        <h3 className="font-body text-sm font-semibold text-heading">
          Tags on this list <span className="font-mono text-xs font-normal text-muted">({tags.length}/{MAX_TAGS})</span>
        </h3>
        {tags.length === 0 ? (
          <p className="mt-2 rounded-lg border border-dashed border-border p-3 font-body text-sm text-muted">
            No tags yet. Type a name above and press Add.
          </p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2" aria-label="Tags on this list">
            {tags.map((t) => (
              <li key={t} className="inline-flex items-center rounded-full border border-border bg-background py-0 pl-3 pr-0.5 font-body text-sm text-foreground sm:py-0.5">
                <Icon name="tag" className="mr-1.5 h-3 w-3 text-muted" /> {t}
                <button type="button" aria-label={`Remove tag ${t}`} onClick={() => setTags(tags.filter((x) => x !== t))}
                  className="grid h-11 w-10 place-items-center rounded-full text-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-soft sm:h-8 sm:w-8">
                  <Icon name="close" className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {submitError && <InlineError>{submitError}</InlineError>}
    </Drawer>
  );
}
