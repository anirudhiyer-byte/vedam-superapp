"use client";

import type { FlowField, FlowScreen } from "../../lib/types";

export type Platform = "android" | "ios";
export type Theme = "light" | "dark";

/**
 * Picture of one flow screen inside a phone frame. It is a picture, not a form:
 * nothing inside can be focused or typed into, and screen readers get one label.
 */
export function PhoneMock({ screen, platform, theme }: { screen: FlowScreen; platform: Platform; theme: Theme }) {
  const dark = theme === "dark";
  const ios = platform === "ios";
  const c = dark
    ? { page: "bg-[#0b141a]", sheet: "bg-[#1f2c33] text-[#e9edef]", sub: "text-[#8696a0]", field: "border-[#3b4a54] bg-[#111b21] text-[#8696a0]", bar: "bg-[#1f2c33] text-[#e9edef]" }
    : { page: "bg-[#efeae2]", sheet: "bg-white text-[#111b21]", sub: "text-[#667781]", field: "border-[#d1d7db] bg-white text-[#667781]", bar: "bg-white text-[#111b21]" };

  return (
    <div role="img" aria-label={`Preview of “${screen.title}” on ${ios ? "iOS" : "Android"}, ${theme} theme`}
      className={`mx-auto w-[260px] max-w-full border-[6px] border-[#2a264a] bg-black p-1 shadow-2xl ${ios ? "rounded-[44px]" : "rounded-[30px]"}`}>
      <div className={`relative flex h-[500px] flex-col overflow-hidden ${ios ? "rounded-[36px]" : "rounded-[22px]"} ${c.page}`}>
        {/* status bar + camera */}
        <div className={`relative flex h-7 shrink-0 items-center justify-between px-5 font-body text-[10px] font-semibold ${c.bar}`}>
          <span>9:41</span>
          {ios
            ? <span className="absolute left-1/2 top-1.5 h-4 w-16 -translate-x-1/2 rounded-full bg-black" />
            : <span className="absolute left-1/2 top-2 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-black" />}
          <span className="flex items-center gap-1"><span className="h-1.5 w-3 rounded-sm bg-current opacity-70" /><span className="h-2 w-4 rounded-sm border border-current" /></span>
        </div>

        {/* flow sheet */}
        <div className="mt-auto flex max-h-[88%] flex-col">
          <div className={`flex flex-col overflow-hidden rounded-t-2xl ${c.sheet}`}>
            <div className={`relative flex items-center gap-2 border-b px-4 py-3 ${dark ? "border-[#3b4a54]" : "border-[#e9edef]"} ${ios ? "justify-center" : ""}`}>
              <span className={`font-body text-lg leading-none ${c.sub} ${ios ? "absolute left-4" : ""}`}>×</span>
              <span className="font-body text-sm font-bold">{screen.title}</span>
            </div>
            <div className="space-y-3 overflow-hidden px-4 py-4">
              {screen.fields.map((f, i) => <MockField key={i} field={f} fieldCls={c.field} subCls={c.sub} ios={ios} />)}
            </div>
            <div className="px-4 pb-4 pt-1">
              <div className={`py-2.5 text-center font-body text-sm font-bold text-white ${ios ? "rounded-full" : "rounded-lg"} bg-[#8A18FF]`}>{screen.cta}</div>
              <p className={`mt-2 text-center font-body text-[9px] ${c.sub}`}>Managed by Vedam School of Technology</p>
            </div>
          </div>
        </div>
        {ios && <span className="absolute bottom-1.5 left-1/2 h-1 w-24 -translate-x-1/2 rounded-full bg-current opacity-40" />}
      </div>
    </div>
  );
}

function MockField({ field, fieldCls, subCls, ios }: { field: FlowField; fieldCls: string; subCls: string; ios: boolean }) {
  if (field.kind === "checkbox") {
    return (
      <div className="flex items-start gap-2 font-body text-xs">
        <span className={`mt-0.5 h-3.5 w-3.5 shrink-0 border ${ios ? "rounded-full" : "rounded-sm"} ${fieldCls}`} />
        <span>{field.label}</span>
      </div>
    );
  }
  return (
    <div>
      <div className={`mb-1 font-body text-[11px] font-semibold ${subCls}`}>{field.label}</div>
      <div className={`flex items-center justify-between border px-3 py-2 font-body text-xs ${ios ? "rounded-xl" : "rounded-md"} ${fieldCls}`}>
        <span>{field.placeholder ?? ""}</span>
        {field.kind === "select" && <span aria-hidden>▾</span>}
        {field.kind === "date" && <span aria-hidden>📅</span>}
      </div>
    </div>
  );
}
