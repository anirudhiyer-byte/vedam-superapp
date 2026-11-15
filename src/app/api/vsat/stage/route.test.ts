import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ getUser: vi.fn(), update: vi.fn(), insert: vi.fn(), app: vi.fn() }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { getUser: m.getUser },
    from: (table: string) => {
      if (table === "crm_activity_log") return { insert: m.insert };
      return {
        select: () => ({ eq: () => ({ maybeSingle: m.app }) }),
        update: (u: unknown) => ({ eq: (...a: unknown[]) => m.update(u, ...a) }),
      };
    },
  }),
}));

import { POST } from "./route";

const req = (body: unknown) => new Request("https://staging.example/api/vsat/stage", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://placeholder.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "placeholder-not-a-key";
  m.getUser.mockResolvedValue({ data: { user: { id: "u-1" } } });
  m.app.mockResolvedValue({ data: { application_id: "VDM-1" } });
  m.update.mockResolvedValue({ error: null });
  m.insert.mockResolvedValue({ error: null });
});

describe("POST /api/vsat/stage (H-01)", () => {
  it("a user cannot approve their own payment", async () => {
    for (const updates of [{ payment_stage_1: "payment_approved" }, { payment_stage_1: "payment_initiated", payment_stage_1_at: "2026-10-30T10:00:00Z" }, { payment_stage_2: "payment_approved" }]) {
      const res = await POST(req({ accessToken: "t", updates }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("field_not_allowed");
    }
    expect(m.update).not.toHaveBeenCalled();
  });
  it("a bad value is refused", async () => {
    const res = await POST(req({ accessToken: "t", updates: { form_stage_1: "hacked" } }));
    expect(res.status).toBe(400);
    expect(m.update).not.toHaveBeenCalled();
  });
  it("allowed fields still save", async () => {
    const res = await POST(req({ accessToken: "t", updates: { form_stage_1: "form_initiated" } }));
    expect(res.status).toBe(200);
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ form_stage_1: "form_initiated" }), "application_id", "VDM-1");
    expect(m.update.mock.calls[0][0]).not.toHaveProperty("payment_stage_1");
  });
  it("database errors are not leaked", async () => {
    m.update.mockResolvedValue({ error: { message: 'invalid input value for enum "vm_form_stage"' } });
    const res = await POST(req({ accessToken: "t", updates: { form_stage_1: "form_initiated" } }));
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).not.toMatch(/enum|vm_form_stage/);
  });
  it("still requires a valid login", async () => {
    m.getUser.mockResolvedValue({ data: { user: null } });
    expect((await POST(req({ accessToken: "bad", updates: { form_stage_1: "form_initiated" } }))).status).toBe(401);
  });
});
