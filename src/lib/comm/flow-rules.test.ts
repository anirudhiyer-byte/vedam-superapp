/** Slice 6 · flow rules (zod) — the same limits as the database (0069). */
import { describe, expect, it } from "vitest";
import { categoryOk, descriptionOk, flowCreateBody, flowScreensSchema, jsonbTextBytes, nameOk } from "./flow-rules";

const screen = (over: Record<string, unknown> = {}) => ({ id: "screen_one", title: "Candidate Details", cta: "Continue",
  fields: [{ label: "Full name", kind: "text", placeholder: "Your name" }, { label: "I agree", kind: "checkbox" }], ...over });
const body = (over: Record<string, unknown> = {}) => ({ name: "ZZ VSAT slot", description: "Line one\nline two", module: "Leads", category: "Admissions", screens: [screen()], ...over });
const okScreens = (s: unknown) => flowScreensSchema.safeParse(s).success;

describe("jsonbTextBytes = Postgres octet_length(jsonb::text)", () => {
  it("matches the value measured on Postgres (271 bytes, with quotes, a backslash and Hindi)", () => {
    const v = [screen({ title: 'Candidate "Details" \\ हिंदी' }), { id: "s2", title: "T", cta: "Go", fields: [] }];
    expect(jsonbTextBytes(v)).toBe(271);
  });
  it("empty array / object", () => {
    expect(jsonbTextBytes([])).toBe(2);
    expect(jsonbTextBytes({})).toBe(2);
  });
});

describe("names, description, category", () => {
  it("name: 1–80 after trimming, no < > or control characters", () => {
    expect(nameOk("  ZZ VSAT Slot ")).toBe(true);
    expect(nameOk("ZZ हिंदी फ़्लो")).toBe(true);
    for (const bad of ["", "   ", "n".repeat(81), "ZZ <script>", "a>b", "tab\tname", "new\nline", "\u0085x", 5]) expect(nameOk(bad)).toBe(false);
  });
  it("description: up to 300, one line break kind allowed (\\n), no tab / < >", () => {
    expect(descriptionOk("")).toBe(true);
    expect(descriptionOk("Line one\nline two")).toBe(true);
    for (const bad of ["tab\tx", "a <b>", "d".repeat(301), "cr\r"]) expect(descriptionOk(bad)).toBe(false);
  });
  it("category: 1–40", () => {
    expect(categoryOk("Admissions")).toBe(true);
    for (const bad of ["", "c".repeat(41), "ZZ <cat>", "cat\n"]) expect(categoryOk(bad)).toBe(false);
  });
});

describe("screens", () => {
  it("a normal screen, 10 screens with no fields, 12 fields: allowed", () => {
    expect(okScreens([screen()])).toBe(true);
    expect(okScreens(Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, title: "T", cta: "Go", fields: [] })))).toBe(true);
    expect(okScreens([screen({ fields: Array.from({ length: 12 }, () => ({ label: "A", kind: "select" })) })])).toBe(true);
  });
  it.each([
    ["no screens", []],
    ["11 screens", Array.from({ length: 11 }, (_, i) => ({ id: `s${i}`, title: "T", cta: "Go", fields: [] }))],
    ["13 fields", [screen({ fields: Array.from({ length: 13 }, () => ({ label: "A", kind: "text" })) })]],
    ["wrong kind", [screen({ fields: [{ label: "A", kind: "file" }] })]],
    ["extra field key", [screen({ fields: [{ label: "A", kind: "text", x: 1 }] })]],
    ["missing kind", [screen({ fields: [{ label: "A" }] })]],
    ["extra screen key", [screen({ onload: "x" })]],
    ["missing cta", [{ id: "screen_one", title: "T", fields: [] }]],
    ["<script> in title", [screen({ title: "<script>alert(1)</script>" })]],
    ["<img> in label", [screen({ fields: [{ label: "<img src=x onerror=alert(1)>", kind: "text" }] })]],
    ["> in cta", [screen({ cta: "Go >" })]],
    ["control char in placeholder", [screen({ fields: [{ label: "A", kind: "text", placeholder: "a\u0007b" }] })]],
    ["blank title", [screen({ title: "   " })]],
    ["title 61", [screen({ title: "t".repeat(61) })]],
    ["cta 31", [screen({ cta: "c".repeat(31) })]],
    ["label 81", [screen({ fields: [{ label: "l".repeat(81), kind: "text" }] })]],
    ["placeholder 61", [screen({ fields: [{ label: "A", kind: "text", placeholder: "p".repeat(61) }] })]],
    ["bad screen id", [screen({ id: "Screen One" })]],
    ["duplicate screen ids", [screen({ id: "s1" }), screen({ id: "s1" })]],
    ["fields not an array", [screen({ fields: {} })]],
    ["over 20 KB", Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, title: "t".repeat(60), cta: "c".repeat(30),
      fields: Array.from({ length: 12 }, () => ({ label: "l".repeat(80), kind: "select", placeholder: "p".repeat(60) })) }))],
    ["not an array", { id: "screen_one" }],
  ])("refused: %s", (_n, s) => { expect(okScreens(s)).toBe(false); });
});

describe("create body (strict)", () => {
  it("valid body passes", () => { expect(flowCreateBody.safeParse(body()).success).toBe(true); });
  it.each([
    ["fromId is never accepted", body({ fromId: "f1" })],
    ["status cannot be set", body({ status: "Active" })],
    ["owner cannot be set", body({ owner_id: "00000000-0000-4000-8000-000000000001" })],
    ["module outside the list", body({ module: "Opportunity" })],
    ["missing screens", (() => { const b: Record<string, unknown> = body(); delete b.screens; return b; })()],
    ["name with <", body({ name: "ZZ <b>" })],
    ["huge name", body({ name: "x".repeat(5000) })],
  ])("refused: %s", (_n, b) => { expect(flowCreateBody.safeParse(b).success).toBe(false); });
});
