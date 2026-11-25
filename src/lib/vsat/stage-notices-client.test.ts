import { describe, expect, it } from "vitest";
import { STAGES_WITH_EMAIL, STAGE_NOTICE_MAX, noticeChunks, sendStageEmailsNow } from "./stage-notices-client";
import { STAGE_NOTICE_STEPS } from "./stage-notices";

describe("stage emails · send now", () => {
  it("knows the same stages as the server job", () => {
    expect([...STAGES_WITH_EMAIL]).toEqual([...STAGE_NOTICE_STEPS]);
  });
  it("splits the students into calls of 100, without repeats", () => {
    const ids = Array.from({ length: 250 }, (_, i) => `A${i}`);
    const chunks = noticeChunks([...ids, "A1", "A2"]);
    expect(chunks.map((c) => c.length)).toEqual([STAGE_NOTICE_MAX, STAGE_NOTICE_MAX, 50]);
    expect(chunks.flat()).toEqual(ids);
    expect(noticeChunks([])).toEqual([]);
  });
  it("posts each chunk to the route as JSON, same origin", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const post = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    expect(await sendStageEmailsNow(["A1", "A2"], post)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/vsat/stage-notices/notify");
    expect(calls[0].init).toMatchObject({ method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" } });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ application_ids: ["A1", "A2"] });
  });
  it("a failed or refused call → false (the cron sends them later)", async () => {
    const refused = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    const down = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await sendStageEmailsNow(["A1"], refused)).toBe(false);
    expect(await sendStageEmailsNow(["A1"], down)).toBe(false);
  });
});
