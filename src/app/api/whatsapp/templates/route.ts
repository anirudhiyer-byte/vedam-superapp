import { requireAdmin } from "@/lib/whatsapp/guard";
import { waListTemplates } from "@/lib/whatsapp/client";
export const dynamic = "force-dynamic";
export async function GET() {
  const { user } = await requireAdmin();
  if (!user) return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  const result = await waListTemplates();
  return Response.json(result);
}
