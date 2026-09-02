import { requireAdmin } from "@/lib/whatsapp/guard";
import { waCreateTemplate } from "@/lib/whatsapp/client";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const { user } = await requireAdmin();
  if (!user) return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  const payload = await req.json();
  if (!payload?.name) return Response.json({ ok: false, error: "name required" }, { status: 400 });
  const result = await waCreateTemplate(payload as Record<string, unknown>);
  return Response.json(result);
}
