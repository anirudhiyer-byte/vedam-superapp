"use client";

import { useCallback, useEffect, useState } from "react";
import { Drawer, Button, Icon, type IconName } from "../../ui/primitives";
import { Tabs, tabPanelProps } from "../../ui/tabs";
import { ErrorState, InlineError, Skeleton } from "../../ui/states";
import { listsApi } from "../../lib/mock-api";
import type { Channel, ListRow, Option } from "../../lib/types";
import { ChannelForm, EMPTY_CHANNEL, validateChannel, type ChannelErrors, type ChannelValues } from "./channel-form";

type Options = Record<Channel, { templates: Option[]; senders: Option[] }>;
type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; options: Options };

const CHANNELS: { key: Channel; label: string; icon: IconName }[] = [
  { key: "email", label: "Email", icon: "mail" },
  { key: "whatsapp", label: "WhatsApp", icon: "whatsapp" },
  { key: "sms", label: "SMS", icon: "sms" },
  { key: "amplify", label: "Amplify", icon: "amplify" },
];
const blank = (): Record<Channel, ChannelValues> => ({ email: EMPTY_CHANNEL, whatsapp: EMPTY_CHANNEL, sms: EMPTY_CHANNEL, amplify: EMPTY_CHANNEL });

/** Communicate drawer: pick a channel, a template and a time for one or more lists. Nothing is really sent. */
export function CommunicateDrawer({ lists, onClose, onSent }: {
  lists: ListRow[]; onClose: () => void; onSent: (message: string) => void;
}) {
  return lists.length ? <CommunicateBody key={lists.map((l) => l.id).join(",")} lists={lists} onClose={onClose} onSent={onSent} /> : null;
}

function CommunicateBody({ lists, onClose, onSent }: { lists: ListRow[]; onClose: () => void; onSent: (message: string) => void }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [tab, setTab] = useState<Channel>("email");
  const [values, setValues] = useState(blank);
  const [errors, setErrors] = useState<ChannelErrors>({});
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fetchOptions = useCallback(() => {
    setLoad({ status: "loading" });
    listsApi.communicateOptions()
      .then((options) => setLoad({ status: "ready", options: options as Options }))
      .catch((e: unknown) => setLoad({ status: "error", message: e instanceof Error ? e.message : "We could not load the templates." }));
  }, []);

  useEffect(fetchOptions, [fetchOptions]);

  const names = lists.map((l) => l.name);
  const leads = lists.reduce((n, l) => n + (l.totalLeads ?? 0), 0);
  const unknownCount = lists.some((l) => l.totalLeads === null);

  const send = async () => {
    if (pending || load.status !== "ready") return;
    const errs = validateChannel(values[tab]);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const v = values[tab];
    setPending(true); setSubmitError(null);
    try {
      const res = await listsApi.communicate({ listIds: lists.map((l) => l.id), channel: tab, template: v.template, sender: v.sender, when: v.when === "now" ? "now" : v.at });
      const label = CHANNELS.find((c) => c.key === tab)!.label;
      onSent(`${label} ${v.when === "now" ? "queued" : "scheduled"} · ${res.campaignId} · ${names.length === 1 ? names[0] : `${names.length} lists`}`);
      onClose();
    } catch (e) {
      setSubmitError(e instanceof Error && e.message ? e.message : "We could not queue this. Please try again.");
    } finally {
      setPending(false);
    }
  };

  const channel = CHANNELS.find((c) => c.key === tab)!;
  return (
    <Drawer open title="Communicate" size="lg" accessible onClose={onClose}
      footer={
        <>
          <Button variant="ghost" touch disabled={pending} onClick={onClose}>Cancel</Button>
          <Button variant="solid" touch icon="send" disabled={pending || load.status !== "ready"} onClick={send}>
            {pending ? "Sending…" : `Send ${channel.label}`}
          </Button>
        </>
      }>
      <p className="font-body text-sm text-muted">
        To <span className="font-semibold text-foreground">{names.length === 1 ? names[0] : `${names.length} lists`}</span>
        {names.length > 1 && <span className="block truncate text-xs">{names.join(", ")}</span>}
      </p>
      {!unknownCount && leads === 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-background p-3 font-body text-xs text-muted">
          <Icon name="info" className="mt-px h-4 w-4 shrink-0" />
          {names.length === 1 ? "This list has" : "These lists have"} no contacts yet, so nothing would reach anyone. Import contacts first.
        </p>
      )}

      {load.status === "loading" && (
        <div aria-busy="true" aria-label="Loading templates" className="grid gap-4 pt-1">
          <Skeleton className="h-11 w-full" /><Skeleton className="h-4 w-32" /><Skeleton className="h-11 w-full" /><Skeleton className="h-4 w-24" /><Skeleton className="h-11 w-full" />
        </div>
      )}
      {load.status === "error" && <ErrorState title="Couldn’t load templates" message={load.message} onRetry={fetchOptions} />}
      {load.status === "ready" && (
        <>
          <Tabs prefix="cm" label="Channel" tabs={CHANNELS} active={tab} onChange={(k) => { setTab(k); setErrors({}); setSubmitError(null); }} />
          <div {...tabPanelProps("cm", tab)} className="pt-2 outline-none focus-visible:outline-2 focus-visible:outline-accent-soft">
            <ChannelForm channel={tab} label={channel.label} templates={load.options[tab].templates} senders={load.options[tab].senders}
              values={values[tab]} errors={errors}
              onChange={(v, edited) => { setValues({ ...values, [tab]: v }); setErrors((e) => { const n = { ...e }; edited.forEach((k) => delete n[k]); return n; }); }} />
          </div>
          {submitError && <InlineError>{submitError}</InlineError>}
        </>
      )}
    </Drawer>
  );
}
