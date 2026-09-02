"use client";
import { useState } from "react";
import { WhatsAppTester } from "@/components/admin/whatsapp-tester";
import { WhatsAppBroadcast } from "@/components/admin/whatsapp-broadcast";
import { WhatsAppSpend } from "@/components/admin/whatsapp-spend";

export default function Page() {
  const [tab, setTab] = useState<"broadcast" | "tester" | "spend">("broadcast");
  return (
    <div>
      <div className="mx-auto flex max-w-3xl gap-2 px-6 pt-8">
        <button onClick={() => setTab("broadcast")} className={["rounded-lg px-4 py-2 font-mono text-xs font-semibold", tab === "broadcast" ? "bg-brand-gradient text-white" : "border border-border-strong bg-surface text-muted"].join(" ")}>Broadcast</button>
        <button onClick={() => setTab("tester")} className={["rounded-lg px-4 py-2 font-mono text-xs font-semibold", tab === "tester" ? "bg-brand-gradient text-white" : "border border-border-strong bg-surface text-muted"].join(" ")}>Tester</button>
        <button onClick={() => setTab("spend")} className={["rounded-lg px-4 py-2 font-mono text-xs font-semibold", tab === "spend" ? "bg-brand-gradient text-white" : "border border-border-strong bg-surface text-muted"].join(" ")}>Spend</button>
      </div>
      {tab === "broadcast" ? <WhatsAppBroadcast /> : tab === "spend" ? <WhatsAppSpend /> : <WhatsAppTester />}
    </div>
  );
}
