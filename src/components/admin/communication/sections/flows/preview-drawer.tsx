"use client";

import { useCallback, useEffect, useState } from "react";
import { Drawer, Select, IconButton } from "../../ui/primitives";
import { RadioGroup } from "../../ui/form";
import { ErrorState, Skeleton } from "../../ui/states";
import { PhoneMock, type Platform, type Theme } from "./phone-mock";
import { flowsApi } from "../../lib/mock-api";
import type { FlowRow, FlowScreen } from "../../lib/types";

type Load = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; screens: FlowScreen[] };

/** Preview drawer, named after the flow. The body mounts fresh for every flow. */
export function PreviewDrawer({ flow, onClose }: { flow: FlowRow | null; onClose: () => void }) {
  return flow ? <PreviewBody key={flow.id} flow={flow} onClose={onClose} /> : null;
}

function PreviewBody({ flow, onClose }: { flow: FlowRow; onClose: () => void }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [screenId, setScreenId] = useState("");
  const [platform, setPlatform] = useState<Platform>("android");
  const [theme, setTheme] = useState<Theme>("light");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const fetchPreview = useCallback(() => {
    setLoad({ kind: "loading" });
    flowsApi.preview(flow.id)
      .then((r) => {
        setLoad({ kind: "ready", screens: r.screens });
        setScreenId((cur) => (r.screens.some((s) => s.id === cur) ? cur : r.screens[0]?.id ?? ""));
      })
      .catch((e: unknown) => setLoad({ kind: "error", message: e instanceof Error && e.message ? e.message : "We could not load the preview." }));
  }, [flow.id]);
  useEffect(fetchPreview, [fetchPreview]);

  const screens = load.kind === "ready" ? load.screens : [];
  const screen = screens.find((s) => s.id === screenId) ?? screens[0];

  return (
    <Drawer open accessible size="lg" title={flow.name} closeLabel="Close preview" onClose={onClose}>
      <p className="font-body text-sm text-muted">How this flow looks to a student on WhatsApp. Nothing is sent from the preview.</p>

      <div className="flex flex-wrap items-end gap-2">
        <div className="grid min-w-0 flex-1 gap-1.5">
          <label htmlFor="flow-preview-screen" className="font-body text-sm font-semibold text-heading">Screen</label>
          <Select id="flow-preview-screen" touch placeholder={load.kind === "loading" ? "Loading…" : "Select screen"}
            disabled={load.kind !== "ready"} value={screen?.id ?? ""}
            options={screens.map((s) => ({ value: s.id, label: `${s.id} · ${s.title}` }))}
            onChange={(v) => v && setScreenId(v)} />
        </div>
        <IconButton touch icon="refresh" label="Refresh preview" onClick={fetchPreview} />
        <IconButton touch icon="gear" label="Preview settings" active={settingsOpen}
          expanded={settingsOpen} controls="flow-preview-settings" onClick={() => setSettingsOpen((v) => !v)} />
      </div>

      {settingsOpen && (
        <div id="flow-preview-settings" className="grid gap-4 rounded-xl border border-border bg-background p-4 sm:grid-cols-2">
          <RadioGroup name="flow-platform" legend="Platform" value={platform} onChange={(v) => setPlatform(v as Platform)}
            options={[{ value: "android", label: "Android" }, { value: "ios", label: "iOS" }]} />
          <RadioGroup name="flow-theme" legend="Theme" value={theme} onChange={(v) => setTheme(v as Theme)}
            options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
        </div>
      )}

      <div aria-live="polite" aria-busy={load.kind === "loading"} className="pt-2">
        {load.kind === "loading" && (
          <div className="mx-auto w-[260px] max-w-full rounded-[30px] border-[6px] border-border p-4">
            <span className="sr-only">Loading preview…</span>
            <Skeleton className="h-4 w-1/2" />
            <div className="mt-[260px] space-y-3"><Skeleton className="h-8" /><Skeleton className="h-8" /><Skeleton className="h-9" /></div>
          </div>
        )}
        {load.kind === "error" && <ErrorState title="Couldn’t load the preview" message={load.message} onRetry={fetchPreview} />}
        {load.kind === "ready" && screen && <PhoneMock screen={screen} platform={platform} theme={theme} />}
      </div>
    </Drawer>
  );
}
