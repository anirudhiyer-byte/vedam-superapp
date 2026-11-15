"use client";

import { Icon, type IconName } from "../../ui/primitives";
import type { AutomationNode, AutomationNodeKind } from "../../lib/types";

const KIND: Record<AutomationNodeKind, { label: string; icon: IconName; tone: string }> = {
  trigger: { label: "Trigger", icon: "flow", tone: "bg-brand-gradient text-white" },
  condition: { label: "IF / ELSE", icon: "segment", tone: "bg-[#3d310f] text-[#fbbf24]" },
  email: { label: "Send Email", icon: "mail", tone: "bg-surface-warm text-accent-soft" },
  whatsapp: { label: "Send WhatsApp", icon: "whatsapp", tone: "bg-[#0f3d29] text-[#4ade80]" },
};

function NodeCard({ node }: { node: AutomationNode }) {
  const k = KIND[node.kind];
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-background p-3">
      <span aria-hidden className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${k.tone}`}><Icon name={k.icon} className="h-4 w-4" /></span>
      <div className="min-w-0">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted">{k.label}</p>
        <p className="mt-0.5 break-words font-body text-sm font-semibold text-heading">{node.title}</p>
        <p className="mt-0.5 break-words font-body text-xs text-muted">{node.detail}</p>
      </div>
    </div>
  );
}

const Connector = () => <span aria-hidden className="mx-[1.15rem] block h-4 w-px bg-border" />;

function Branch({ label, nodes }: { label: "Yes" | "No"; nodes: AutomationNode[] }) {
  return (
    <section aria-label={`If ${label.toLowerCase()}`} className="min-w-0 rounded-xl border border-border bg-surface p-3">
      <p className={`mb-2 font-mono text-[10px] font-bold uppercase tracking-wider ${label === "Yes" ? "text-[#4ade80]" : "text-[#f87171]"}`}>{label}</p>
      {nodes.length ? <NodeList nodes={nodes} label={`${label} branch`} /> : <p className="font-body text-xs text-muted">No action. The record leaves the automation here.</p>}
    </section>
  );
}

function NodeList({ nodes, label }: { nodes: AutomationNode[]; label: string }) {
  return (
    <ol aria-label={label}>
      {nodes.map((n, i) => (
        <li key={n.id}>
          {i > 0 && <Connector />}
          <NodeCard node={n} />
          {n.kind === "condition" && (
            <>
              <Connector />
              <div className="grid gap-3 sm:grid-cols-2">
                <Branch label="Yes" nodes={n.yes ?? []} />
                <Branch label="No" nodes={n.no ?? []} />
              </div>
            </>
          )}
        </li>
      ))}
    </ol>
  );
}

/** The workflow as a top-to-bottom list of boxes (it reads the same on a phone as on a desktop). Read-only in this preview. */
export function WorkflowCanvas({ nodes }: { nodes: AutomationNode[] }) {
  return <NodeList nodes={nodes} label="Automation workflow" />;
}
