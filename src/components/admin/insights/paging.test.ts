import { describe, expect, it } from "vitest";
import { loadPages, type FetchPage } from "./paging";

/** A fake RPC over `n` numbered rows that records every range it was asked for. */
function fake(n: number, opts: { failAt?: number } = {}) {
  const calls: [number, number][] = [];
  const fetchPage: FetchPage<number> = async (from, to) => {
    calls.push([from, to]);
    if (opts.failAt !== undefined && from >= opts.failAt) return { data: null, error: { message: "boom" } };
    const rows: number[] = [];
    for (let i = from; i <= to && i < n; i++) rows.push(i);
    return { data: rows, error: null };
  };
  return { fetchPage, calls };
}

describe("loadPages (people list, D4)", () => {
  it("hands over each page as it arrives, in order, and stops at the first empty page", async () => {
    const { fetchPage, calls } = fake(2500);
    const pages: number[][] = [];
    const res = await loadPages(fetchPage, (rows) => pages.push(rows));
    expect(pages.map((p) => p.length)).toEqual([1000, 1000, 500]);
    expect(pages.flat()).toEqual(Array.from({ length: 2500 }, (_, i) => i));
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999], [2500, 3499]]);
    expect(res).toEqual({ error: null, total: 2500, stopped: false });
  });

  it("an empty list makes one call and no page", async () => {
    const { fetchPage, calls } = fake(0);
    const pages: number[][] = [];
    const res = await loadPages(fetchPage, (rows) => pages.push(rows));
    expect(pages).toEqual([]);
    expect(calls.length).toBe(1);
    expect(res.total).toBe(0);
  });

  it("the first page is available before the rest have loaded", async () => {
    const { fetchPage } = fake(3000);
    const seen: number[] = [];
    await loadPages(fetchPage, (rows) => seen.push(rows.length));
    expect(seen[0]).toBe(1000);
  });

  it("stops without further requests when the drawer closes mid-way", async () => {
    const { fetchPage, calls } = fake(5000);
    let live = true;
    const pages: number[][] = [];
    const res = await loadPages(fetchPage, (rows) => { pages.push(rows); if (pages.length === 2) live = false; }, () => live);
    expect(pages.length).toBe(2);
    expect(calls.length).toBe(2);
    expect(res.stopped).toBe(true);
  });

  it("drops a page that arrives after the drawer closed", async () => {
    let live = true;
    const fetchPage: FetchPage<number> = async () => { live = false; return { data: [1, 2, 3], error: null }; };
    const pages: number[][] = [];
    const res = await loadPages(fetchPage, (rows) => pages.push(rows), () => live);
    expect(pages).toEqual([]);
    expect(res.stopped).toBe(true);
  });

  it("keeps the rows already shown and reports the error when a later page fails", async () => {
    const { fetchPage } = fake(3000, { failAt: 1000 });
    const pages: number[][] = [];
    const res = await loadPages(fetchPage, (rows) => pages.push(rows));
    expect(pages.flat().length).toBe(1000);
    expect(res).toEqual({ error: "boom", total: 1000, stopped: false });
  });

  it("works when the server returns smaller pages than asked for", async () => {
    // e.g. the API row cap is lower than pageSize: keep reading until an empty page
    const fetchPage: FetchPage<number> = async (from) => {
      const rows: number[] = [];
      for (let i = from; i < Math.min(from + 300, 700); i++) rows.push(i);
      return { data: rows, error: null };
    };
    const pages: number[][] = [];
    const res = await loadPages(fetchPage, (rows) => pages.push(rows));
    expect(pages.map((p) => p.length)).toEqual([300, 300, 100]);
    expect(res.total).toBe(700);
  });
});
