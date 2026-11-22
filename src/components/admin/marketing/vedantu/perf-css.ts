/**
 * Vedantu Performance styles (prefix vvp-), used inside .vcn with the Listing tokens and the Consultant Performance
 * dialog styles (vcp-). Layout follows the vedamcrm360 Vedantu Performance page: filter bar, 6 + 4 cards, drill dialog.
 */
export const VP_CSS = `
.vvp-bar{margin-bottom:24px;padding:16px;border-radius:16px;border:1px solid var(--bd);background:var(--surf);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
.vvp-bar-in{display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px}
@media (min-width:768px){.vvp-bar-in{gap:12px}}
.vvp-f label{display:block;margin-bottom:6px;font-size:12px;line-height:16px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--fg80)}
.vvp-date{position:relative}
.vvp-date .vcn-ico{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--fg40);pointer-events:none}
.vvp-date .vcn-in{padding-left:36px;color-scheme:dark;width:172px}
.vvp-f .vcn-sel.cp{min-width:200px;max-width:260px}.vvp-f .vcn-sel.ch{min-width:180px;max-width:260px}
.vvp-n{margin-left:auto;font-size:14px;line-height:20px;font-weight:700;color:var(--fg80);font-variant-numeric:tabular-nums}
.vvp-rerr{flex-basis:100%;margin:2px 0 0;font-size:12.5px;font-weight:600;color:#ff6b9a}

.vvp-k6,.vvp-k4{display:grid;gap:12px}
.vvp-k6{grid-template-columns:repeat(2,minmax(0,1fr));margin-bottom:16px}
.vvp-k4{grid-template-columns:minmax(0,1fr);margin-bottom:24px}
@media (min-width:640px){.vvp-k6{grid-template-columns:repeat(3,minmax(0,1fr))}.vvp-k4{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (min-width:1024px){.vvp-k6{grid-template-columns:repeat(6,minmax(0,1fr))}.vvp-k4{grid-template-columns:repeat(4,minmax(0,1fr))}}
.vvp-c{position:relative;overflow:hidden;min-width:0;padding:16px;border-radius:16px;border:1px solid var(--bd);background:var(--surf);
  -webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);color:var(--fg);text-align:left;font:inherit}
.vvp-c::before{content:"";position:absolute;top:0;left:0;right:0;height:2px;opacity:.75;background:linear-gradient(90deg,transparent,var(--k),var(--k2,var(--k)),transparent)}
.vvp-h{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}
.vvp-l{font-size:12px;line-height:1.15;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--fg80)}
.vvp-h .vcn-ico{color:var(--k);opacity:.6}
.vvp-v{font-size:26px;line-height:1;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums;color:var(--k);white-space:nowrap}
.vvp-v.ld{color:var(--fg40)}
.vvp-s{margin-top:6px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--fg50)}
.vvp-dr{margin-top:6px;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--fg40);opacity:0;transition:opacity .15s}
.vvp-two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.vvp-half{min-width:0;margin:-8px;padding:8px;border:0;border-radius:8px;background:none;color:inherit;text-align:left;font:inherit}
.vvp-half .vvp-sl{margin-bottom:6px;font-size:11px;line-height:1;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--fg50)}
button.vvp-half{cursor:pointer;transition:background-color .15s}
button.vvp-half:hover,button.vvp-half:focus-visible{background:var(--surfh)}
button.vvp-half:hover .vvp-dr,button.vvp-half:focus-visible .vvp-dr{opacity:1}
button.vvp-c{cursor:pointer;transition:border-color .15s}
button.vvp-c:hover,button.vvp-c:focus-visible{border-color:var(--bds)}
button.vvp-c:hover .vvp-dr,button.vvp-c:focus-visible .vvp-dr{opacity:1}
@media (hover:none){.vvp-dr{opacity:1}}
.vvp-empty{padding:48px 16px;border-radius:16px;border:1px solid var(--bd);background:var(--surf);text-align:center;font-weight:700;color:var(--fg80)}
.vvp-empty span{display:block;margin-top:4px;font-size:14px;font-weight:500;color:var(--fg50)}

.vvp-tools{display:flex;align-items:center;gap:12px;padding:12px 24px;border-bottom:1px solid var(--bd)}
.vvp-tools .vcn-search{flex:1;min-width:0}
.vvp-x{display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 12px;border-radius:8px;border:1px solid color-mix(in srgb,var(--k) 40%,transparent);
  background:var(--inp);color:var(--fg);font:600 13px var(--ui);cursor:pointer;white-space:nowrap}
.vvp-x .vcn-ico{color:var(--k)}.vvp-x small{font-size:13px;color:var(--fg80);font-variant-numeric:tabular-nums}
.vvp-x:hover{background:var(--surfh)}.vvp-x:disabled{opacity:.5;cursor:not-allowed}
.vvp-note{margin:10px 24px 0;padding:8px 12px;border-radius:9px;font-size:12px;color:var(--fg70);background:color-mix(in srgb,var(--k) 6%,transparent);
  border:1px solid color-mix(in srgb,var(--k) 25%,transparent)}
.vvp-dt{border-collapse:collapse;font-size:13px}
.vvp-dt thead{position:sticky;top:0;z-index:3;background:#1a1636}
.vvp-dt th{min-width:140px;padding:10px 12px;text-align:left;white-space:nowrap;border-bottom:1px solid var(--bd)}
.vvp-dt th button{display:inline-flex;align-items:center;gap:4px;padding:0;border:0;background:none;color:var(--fg80);font:700 12px var(--ui);
  letter-spacing:.06em;text-transform:uppercase;cursor:pointer}
.vvp-dt th button:hover,.vvp-dt th button.on{color:var(--fg)}
.vvp-dt th button .vcn-ico{opacity:.4}.vvp-dt th button.on .vcn-ico{opacity:1;color:var(--k)}
.vvp-dt tr.flt th{padding:6px 8px;background:var(--surfh)}
.vvp-dt tr.flt input{width:100%;height:28px;padding:0 8px;border-radius:4px;border:1px solid var(--bd);background:var(--inp);color:var(--fg);font:400 12.5px var(--ui);outline:none}
.vvp-dt tr.flt input:focus{box-shadow:0 0 0 2px color-mix(in srgb,var(--k) 50%,transparent)}
.vvp-dt td{padding:8px 12px;white-space:nowrap;color:var(--fg80);border-bottom:1px solid var(--bd);max-width:320px;overflow:hidden;text-overflow:ellipsis}
.vvp-dt tbody tr:hover td{background:var(--surfh)}
.vvp-nomatch{padding:48px 16px;text-align:center;color:var(--fg60);font-size:14px;font-weight:600}
.vvp-md .vcn-pg{flex-shrink:0}
@media (max-width:760px){.vvp-tools{padding:10px 16px;flex-wrap:wrap}.vvp-note{margin:10px 16px 0}}
`;
