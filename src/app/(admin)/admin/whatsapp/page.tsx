"use client";
import { useState } from "react";
import { WhatsAppTester } from "@/components/admin/whatsapp-tester";
import { WhatsAppBroadcast } from "@/components/admin/whatsapp-broadcast";
import { WhatsAppSpend } from "@/components/admin/whatsapp-spend";
import { WhatsAppTemplateBuilder } from "@/components/admin/whatsapp-template-builder";
import { WhatsAppAutomations } from "@/components/admin/whatsapp-automations";

export default function Page() {
  const [tab, setTab] = useState<"broadcast" | "automations" | "templates" | "tester" | "spend">("broadcast");
  return (
    <div>
      <div className="mx-auto flex max-w-3xl gap-2 px-6 pt-8">
        <button onClick={() => setTab("broadcast")} className={["rounded-lg px-4 py-2 font-mono text-xs font-semibold", tab === "broadcast" ? "bg-brand-gradient text-white" : "border border-border-strong bg-surface text-muted"].join(" ")}>Broadcast</button>
        <button onClick={() => setTab("automations")} className={["rounded-lg px-4 py-2 font-mono text-xs font-semibold", tab === "automations" ? "bg-brand-gradient text-white" : "border border-border-strong bg-surface text-muted"].join(" ")}>Automations</button>
        <button onClick={() => setTab("templates")} className={["rounded-lg px-4 py-2 font-mono text-xs font-semibold", tab === "templates" ? "bg-brand-gradient text-white" : "border border-border-strong bg-surface text-muted"].join(" ")}>Templates</button>
        <button onClick={() => setTab("tester")} className={["rounded-lg px-4 py-2 font-mono text-xs font-semibold", tab === "tester" ? "bg-brand-gradient text-white" : "border border-border-strong bg-surface text-muted"].join(" ")}>Tester</button>
        <button onClick={() => setTab("spend")} className={["rounded-lg px-4 py-2 font-mono text-xs font-semibold", tab === "spend" ? "bg-brand-gradient text-white" : "border border-border-strong bg-surface text-muted"].join(" ")}>Spend</button>
      </div>
      {tab === "broadcast" ? <WhatsAppBroadcast /> : tab === "automations" ? <WhatsAppAutomations /> : tab === "templates" ? <WhatsAppTemplateBuilder /> : tab === "spend" ? <WhatsAppSpend /> : <WhatsAppTester />}
    </div>
  );
}
