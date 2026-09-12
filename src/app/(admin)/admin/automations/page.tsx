import { AutomationBuilder } from "@/components/admin/automation-builder";
export const dynamic = "force-dynamic";
export const metadata = { title: "Automations", robots: { index: false } };
export default function Page() { return <AutomationBuilder />; }
