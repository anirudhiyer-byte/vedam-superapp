/**
 * Telegram Performance styles (prefix vtp-), on top of the Consultant styles (vcn- / vcp-: modal, table, banners).
 * Sizes are the vedamcrm360 Telegram Dashboard's Tailwind classes, in Vedam One's dark theme.
 */
export const TP_CSS = `
.vtp{--tg:#229ed9}
.vtp-stack{display:flex;flex-direction:column;gap:20px}
.vtp-head{display:flex;align-items:center;gap:12px;margin-bottom:24px}
.vtp-tile{display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;flex-shrink:0;border-radius:16px;color:#fff;
  background:linear-gradient(135deg,var(--tg),#229ed9aa)}
.vtp-tile .vcn-ico{width:24px;height:24px}
.vtp-h1{margin:0;font-family:var(--h);font-size:30px;line-height:36px;font-weight:700;letter-spacing:-.025em;color:var(--tg)}
.vtp-sub{margin:4px 0 0;font-size:14px;color:var(--fg70)}
.vtp-tabs{display:flex;flex-wrap:wrap;gap:4px;border-bottom:2px solid var(--bds);margin-bottom:24px}
.vtp-tab{display:flex;align-items:center;gap:8px;padding:10px 16px;margin-bottom:-2px;border:0;border-bottom:2px solid transparent;background:none;
  color:var(--fg70);font-size:14px;font-weight:700;cursor:pointer;transition:color .15s}
.vtp-tab:hover{color:var(--fg)}
.vtp-tab.on{color:var(--k);border-bottom-color:var(--k)}
.vtp-bar{display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px;padding:16px;border:1px solid var(--bd);border-radius:16px;background:var(--surf)}
.vtp-f{display:block}
.vtp-fl{display:flex;align-items:center;gap:4px;margin-bottom:6px;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--fg60)}
.vtp-in{height:36px;padding:0 12px;border:1px solid var(--bd);border-radius:6px;background:var(--inp);color:var(--fg);font-size:14px;color-scheme:dark}
.vtp-in option{background:#110d2e;color:#fff}
.vtp-sel{min-width:150px}
.vtp-in.sm{height:32px;padding:0 8px;border-radius:4px}
.vtp-in.grow{flex:1;min-width:120px}
.vtp-grow{flex:1}
.vtp-note{align-self:center;margin-left:8px;font-size:12px;font-style:italic;color:var(--fg60)}
.vtp-ld{display:inline-flex;align-items:center;gap:8px;font-size:14px;font-weight:600;color:var(--fg60)}
.vtp-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
@media (min-width:640px){.vtp-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (min-width:1024px){.vtp-kpis{grid-template-columns:repeat(5,minmax(0,1fr))}}
.vtp-k{position:relative;overflow:hidden;display:block;width:100%;padding:16px;text-align:left;font:inherit;color:inherit;
  border:1px solid var(--bd);border-radius:16px;background:var(--surf);box-shadow:0 10px 30px -10px color-mix(in srgb,var(--k) 19%,transparent)}
.vtp-k::before{content:"";position:absolute;top:0;left:0;right:0;height:1px;opacity:.6;background:linear-gradient(90deg,transparent,var(--k),transparent)}
.vtp-k.go{cursor:pointer}
.vtp-k.go:hover{border-color:var(--bds)}
.vtp-kh{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
.vtp-kl{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--fg70)}
.vtp-ki{display:inline-flex;color:var(--k);opacity:.6}
.vtp-kv{display:block;font-size:22px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--k)}
.vtp-kd{display:flex;align-items:center;gap:2px;margin-top:4px;font-size:9px;color:var(--fg60)}
.vtp-fun{padding:24px;border:1px solid var(--bd);border-radius:16px;background:var(--surf);display:flex;flex-direction:column;gap:12px}
.vtp-funh{margin-bottom:8px;font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--fg80)}
.vtp-fr{display:grid;grid-template-columns:110px 1fr;gap:16px;align-items:center}
.vtp-frl{font-size:15px;font-weight:700;letter-spacing:.025em;text-transform:uppercase;color:var(--k);line-height:1.25}
.vtp-frs{margin-top:2px;font-size:12px;font-weight:700;color:var(--fg80)}
.vtp-trk{position:relative;height:40px;border-radius:6px;background:var(--surfh)}
.vtp-fill{display:flex;align-items:center;justify-content:flex-end;height:100%;min-width:50px;padding:0 12px;border-radius:6px;background:var(--k)}
.vtp-fill span,.vtp-out{font-size:14px;font-weight:800;font-variant-numeric:tabular-nums}
.vtp-fill span{color:#fff}
.vtp-out{position:absolute;top:50%;transform:translateY(-50%);color:var(--fg)}
.vtp-hint{display:flex;align-items:center;gap:8px;font-size:12px;font-style:italic;color:var(--fg60)}
.vtp-two{display:grid;grid-template-columns:1fr;gap:16px}
@media (min-width:1024px){.vtp-two{grid-template-columns:1fr 1fr}}
.vtp-slot{overflow:hidden;border:1px solid var(--bd);border-top:3px solid var(--k);border-radius:16px;background:var(--surf)}
.vtp-sh{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--bd)}
.vtp-tag{flex-shrink:0;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--k)}
.vtp-empty{padding:40px;text-align:center;font-size:14px;font-style:italic;color:var(--fg60)}
.vtp-empty.err{font-style:normal;color:#ff8fa3}
.vtp-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:16px}
.vtp-ms{padding:10px;border-radius:8px;background:var(--surfh)}
.vtp-msl{font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--fg60)}
.vtp-msv{margin-top:2px;font-size:16px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--k)}
.vtp-dbody{flex:1;min-height:0;display:grid;grid-template-columns:1fr;overflow:auto}
@media (min-width:1024px){.vtp-dbody{grid-template-columns:1fr 300px;overflow:hidden}}
.vtp-dt{overflow:auto;border-right:1px solid var(--bd)}
.vtp-t th{white-space:nowrap}
.vtp-t td{white-space:nowrap;color:var(--fg80)}
.vtp-t td.nm{font-weight:600;color:var(--fg)}
.vtp-t td.em{max-width:200px;overflow:hidden;text-overflow:ellipsis}
.vtp-t td.num{font-variant-numeric:tabular-nums}
.vtp-t td.st{font-weight:600}
.vtp-t td.st.enr{color:#e80074}
.vtp-none{padding:32px 16px;text-align:center;font-size:14px;color:var(--fg60)}
.vtp-side{overflow:auto;padding:16px;display:flex;flex-direction:column;gap:6px}
.vtp-stg{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;border:1px solid var(--bd);border-left:3px solid var(--tg);
  border-radius:8px;background:var(--surfh);font-size:12px;font-weight:600;color:var(--fg80)}
.vtp-stg b{font-size:15px;font-weight:800;font-variant-numeric:tabular-nums;color:var(--fg)}
.vtp-stg.enr{border-left-color:#e80074}
.vtp-stg.enr b{color:#e80074}
@media (max-width:767px){.vtp-h1{font-size:26px;line-height:32px}}
`;
