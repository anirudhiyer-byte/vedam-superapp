/**
 * VSAT admin look: one set of class recipes so every page shares the same type, cards, buttons, inputs, tables and
 * badges. Brand colours (Vedam Visual Identity) live in tailwind.config.ts under `vx`; the font is Outfit (font-sans).
 *
 * Use:  <div className={vx.card}>…</div>   <button className={cx(vx.btn, vx.primary)}>Save</button>
 * Keep every class written out in full here (Tailwind only sees literal class names).
 */

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

const btn =
  "inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-[11px] border px-4 font-sans text-sm font-medium " +
  "transition-[background-color,border-color,color,filter] duration-150 " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-violet-t " +
  "disabled:cursor-not-allowed disabled:opacity-45";

const field =
  "h-10 rounded-[11px] border border-vx-line2 bg-black/20 px-3 font-sans text-sm text-vx-ink placeholder:text-vx-faint " +
  "focus:border-vx-violet focus:outline-none focus:ring-2 focus:ring-vx-violet/30 disabled:opacity-50";

export const vx = {
  // page frame + type
  page: "mx-auto w-full max-w-[1200px] px-4 py-6 font-sans sm:px-8 sm:py-10",
  head: "mb-7 flex flex-wrap items-end justify-between gap-4",
  h1: "font-sans text-[26px] font-semibold leading-tight tracking-[-0.025em] text-vx-ink sm:text-[30px]",
  sub: "mt-2 max-w-[70ch] text-[15px] leading-relaxed text-vx-mut",
  h2: "font-sans text-[17px] font-semibold tracking-[-0.01em] text-vx-ink",
  h3: "font-sans text-[15px] font-semibold text-vx-ink",
  note: "text-[13px] leading-relaxed text-vx-faint",
  mono: "font-mono text-[12px] text-vx-faint",

  // surfaces
  card:
    "rounded-[18px] border border-vx-line bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.018))] " +
    "shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]",
  pad: "p-5 sm:p-6",
  hover: "transition-colors duration-150 hover:border-[rgba(138,24,255,0.45)]",
  well: "rounded-xl border border-vx-line bg-black/20", // a panel inside a card

  // buttons: vx.btn + one tone (+ vx.sm)
  btn,
  primary: "border-transparent bg-vx-violet text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] hover:brightness-110",
  cta:
    "border-transparent bg-[linear-gradient(100deg,#f97d03_0%,#c43ccf_55%,#8a18ff_100%)] font-semibold text-white " +
    "shadow-[0_8px_24px_-10px_rgba(196,60,207,0.7)] hover:brightness-110",
  secondary: "border-vx-line2 bg-white/[0.04] text-vx-ink hover:bg-white/[0.08]",
  ghost: "border-vx-line bg-transparent text-vx-mut hover:bg-white/[0.04] hover:text-vx-ink",
  danger: "border-[rgba(255,107,129,0.35)] bg-[rgba(255,107,129,0.08)] text-vx-red hover:bg-[rgba(255,107,129,0.15)]",
  sm: "h-8 rounded-[9px] px-3 text-[13px]",
  dashed:
    "inline-flex items-center justify-center gap-2 rounded-[11px] border border-dashed border-vx-line2 px-4 py-2.5 text-sm text-vx-mut " +
    "transition-colors hover:border-vx-violet/60 hover:text-vx-ink",

  // form fields
  field, // an input / select without a width
  input: "w-full " + field,
  textarea:
    "w-full rounded-[11px] border border-vx-line2 bg-black/20 px-3 py-2.5 font-sans text-sm text-vx-ink placeholder:text-vx-faint " +
    "focus:border-vx-violet focus:outline-none focus:ring-2 focus:ring-vx-violet/30 disabled:opacity-50",
  label: "mb-1.5 block text-[13px] font-medium text-vx-mut",
  check: "h-4 w-4 rounded accent-[#8a18ff]",

  // tables
  table: "w-full border-collapse font-sans text-sm",
  th: "border-b border-vx-line bg-white/[0.02] px-4 py-3 text-left text-[12.5px] font-medium text-vx-faint",
  td: "border-b border-vx-line-soft px-4 py-3 align-middle text-vx-mut",
  row: "transition-colors hover:bg-white/[0.025]",

  // badges + chips: vx.badge + vx.tone.x
  badge: "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-0.5 text-[12.5px] font-medium",
  tone: {
    violet: "bg-vx-violet/[0.16] text-vx-violet-t",
    orange: "bg-vx-orange/[0.13] text-vx-orange-t",
    green: "bg-vx-green/[0.12] text-vx-green",
    teal: "bg-vx-teal/[0.12] text-vx-teal-t",
    red: "bg-vx-red/[0.12] text-vx-red",
    neutral: "bg-white/[0.06] text-vx-mut",
  },
  chip: "inline-flex items-center gap-1.5 rounded-full border border-vx-line bg-white/[0.045] px-2.5 py-0.5 text-[12.5px] text-vx-mut",
  dot: "inline-block h-[7px] w-[7px] flex-none rounded-full",

  // messages
  link: "font-medium text-vx-violet-t underline-offset-4 hover:underline",
  error: "rounded-xl border border-[rgba(255,107,129,0.3)] bg-[rgba(255,107,129,0.08)] px-4 py-3 text-sm text-[#ffb3bf]",
  ok: "rounded-xl border border-vx-green/30 bg-vx-green/[0.08] px-4 py-3 text-sm text-vx-green",
  info: "rounded-xl border border-vx-line bg-white/[0.03] px-4 py-3 text-sm text-vx-ink",
} as const;

export type VxTone = keyof typeof vx.tone;
