"use client";

import { useState } from "react";
import { Modal, Button, TextArea, Icon } from "../ui/primitives";
import { Field } from "../ui/form";
import { REASON_MAX, reasonIssue } from "../lib/live-suppressions";

/**
 * Live Suppressions (Slice 2): confirm Remove with a reason (10–200 characters, kept in the audit log).
 * Only for entries added in the admin panel; the server refuses STOP / unsubscribe / bounce entries.
 * The body mounts fresh every time it opens, so the reason never carries over.
 */
export function RemoveReasonDialog(props: {
  open: boolean; label: string; channel: string; pending: boolean; error: string | null;
  onCancel: () => void; onConfirm: (reason: string) => void;
}) {
  return props.open ? <Body {...props} /> : null;
}

function Body({ label, channel, pending, error, onCancel, onConfirm }: {
  label: string; channel: string; pending: boolean; error: string | null; onCancel: () => void; onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const issue = reasonIssue(reason);
  const submit = () => { setTried(true); if (!issue && !pending) onConfirm(reason.trim()); };

  return (
    <Modal open title="Remove from suppression list?" role="alertdialog" onClose={() => { if (!pending) onCancel(); }}
      footer={
        <>
          <Button variant="ghost" touch disabled={pending} onClick={onCancel}>Cancel</Button>
          <Button variant="danger" touch disabled={pending} onClick={submit}>{pending ? "Please wait…" : "Remove"}</Button>
        </>
      }>
      <p className="font-body text-sm text-muted">{label} will start receiving {channel} communication again.</p>
      <div className="mt-3">
        <Field id="sup-remove-reason" stacked required label="Reason" hint={`(at least 10 characters, saved in the audit log)`}
          error={tried && issue ? issue : undefined}>
          <TextArea id="sup-remove-reason" touch rows={3} maxLength={REASON_MAX} placeholder="e.g. Added by mistake, the person asked to receive updates again"
            value={reason} onChange={setReason} disabled={pending} invalid={!!(tried && issue)}
            describedBy={tried && issue ? "sup-remove-reason-error" : undefined} />
        </Field>
      </div>
      {error && <p role="alert" className="mt-3 flex items-start gap-1.5 font-body text-xs font-semibold text-[#f87171]"><Icon name="alert" className="mt-px h-3.5 w-3.5 shrink-0" /><span>{error}</span></p>}
    </Modal>
  );
}
