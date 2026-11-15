import { describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ after: vi.fn() }));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => m.after(fn) }));

import { afterResponse } from "./after-response";

describe("afterResponse", () => {
  it("inside a request: hands the task to Next.js after() and does not run it now", () => {
    m.after.mockImplementation(() => undefined);
    const task = vi.fn(async () => undefined);
    afterResponse(task);
    expect(m.after).toHaveBeenCalledTimes(1);
    expect(task).not.toHaveBeenCalled();
  });

  it("outside a request (after() throws): runs the task right away", () => {
    m.after.mockImplementation(() => {
      throw new Error("`after` was called outside a request scope");
    });
    const task = vi.fn(async () => undefined);
    afterResponse(task);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("a failing task never throws to the caller", async () => {
    m.after.mockImplementation((fn: () => Promise<unknown>) => fn());
    const task = vi.fn(async () => {
      throw new Error("google down");
    });
    expect(() => afterResponse(task)).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(task).toHaveBeenCalledTimes(1);
  });
});
