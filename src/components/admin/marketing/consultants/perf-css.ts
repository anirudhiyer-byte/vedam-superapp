/**
 * Consultant Performance styles (prefix vcp-), used inside .vcn so they share the Listing's staging tokens
 * (colours, Outfit / Inter, --tap sizes). Layout follows the vedamcrm360 Consultants Dashboard.
 */
export const PERF_CSS = `
.vcp-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:14px}
.vcp-lab{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--mut2)}
.vcp-pb{display:inline-flex;align-items:center;gap:4px;min-height:max(32px,var(--ttap));padding:5px 12px;border-radius:8px;border:1px solid var(--line);background:var(--in);
  color:var(--mut);font:600 12px var(--ui);cursor:pointer;transition:background-color .15s,color .15s,border-color .15s;white-space:nowrap}
.vcp-pb:hover{color:var(--ink);background:var(--hov)}
.vcp-pb[aria-pressed="true"]{background:color-mix(in srgb,var(--a) 10%,transparent);border-color:color-mix(in srgb,var(--a) 50%,transparent);color:var(--a)}
.vcp-rng{font-size:11px;font-weight:600;color:var(--mut);font-variant-numeric:tabular-nums}
.vcp-date{min-height:max(32px,var(--ttap));padding:4px 8px;border-radius:8px;border:1px solid var(--line2,rgba(170,160,255,.22));background:var(--in);color:var(--ink);
  font:500 12px var(--ui);color-scheme:dark}
.vcp-ms{position:relative}
.vcp-msb{display:inline-flex;align-items:center;justify-content:space-between;gap:8px;min-width:150px;max-width:240px;min-height:max(36px,var(--tap));padding:6px 12px;border-radius:9px;
  border:1px solid var(--line2,rgba(170,160,255,.22));background:var(--in);color:var(--ink);font:400 13.5px var(--ui);cursor:pointer}
.vcp-msb span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.vcp-msb:hover{border-color:rgba(170,160,255,.32)}
.vcp-msm{position:absolute;z-index:40;left:0;top:calc(100% + 4px);min-width:210px;max-height:300px;overflow:auto;padding:4px 0;border-radius:10px;
  border:1px solid var(--line2,rgba(170,160,255,.22));background:#15122d;box-shadow:0 18px 40px -12px rgba(0,0,0,.6)}
.vcp-mso{display:flex;width:100%;align-items:center;gap:8px;padding:7px 12px;min-height:max(32px,var(--ttap));border:0;background:none;color:color-mix(in srgb,var(--ink) 85%,transparent);
  font:400 13px var(--ui);text-align:left;cursor:pointer}
.vcp-mso:hover,.vcp-mso:focus-visible{background:var(--hov);outline:none}
.vcp-mso.clr{font-size:12px;color:var(--mut2);border-top:1px solid var(--line);margin-top:4px}
.vcp-box{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex-shrink:0;border-radius:4px;border:1px solid var(--line2,rgba(170,160,255,.3));color:#fff}
.vcp-box.on{background:var(--a);border-color:var(--a)}
.vcp-none{padding:8px 12px;font-size:12px;color:var(--mut2)}

.vcp-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:18px}
@media (min-width:640px){.vcp-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (min-width:1180px){.vcp-kpis.k7{grid-template-columns:repeat(7,minmax(0,1fr))}.vcp-kpis.k5{grid-template-columns:repeat(5,minmax(0,1fr))}}
.vcp-kpi{text-align:left;font:inherit;color:inherit;width:100%}
button.vcp-kpi{display:flex;flex-direction:column;justify-content:flex-start;align-items:stretch;cursor:pointer;transition:border-color .15s,background-color .15s}
button.vcp-kpi:hover{border-color:color-mix(in srgb,var(--k) 45%,transparent);background:color-mix(in srgb,var(--panel) 80%,var(--hov))}
.vcp-kl{display:flex;align-items:center;justify-content:space-between;gap:6px}
.vcp-view{white-space:nowrap;font-size:10px;font-weight:600;letter-spacing:0;text-transform:none;color:var(--k)}
.vcp-kpi .vcn-kpi-s{font-style:italic;font-weight:600}

.vcp-ch{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;padding:12px 18px;border-bottom:1px solid var(--line)}
.vcp-ct{display:flex;align-items:center;gap:8px;font-family:var(--h);font-size:16px;font-weight:700}
.vcp-ct svg{color:var(--a)}
.vcp-cr{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.vcp-hint{font-size:10.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--mut2)}
.vcp-sb{display:inline-flex;align-items:center;gap:6px;min-height:max(32px,var(--ttap));padding:5px 10px;border-radius:8px;border:1px solid var(--line);background:var(--in);
  color:var(--mut);font:600 12px var(--ui);cursor:pointer;white-space:nowrap}
.vcp-sb:hover{color:var(--ink);background:var(--hov)}.vcp-sb:disabled{opacity:.5;cursor:default}
.vcp-popw{position:relative}
.vcp-pop{position:absolute;right:0;top:calc(100% + 4px);z-index:40;width:240px;padding:12px;border-radius:10px;border:1px solid var(--line2,rgba(170,160,255,.22));
  background:#15122d;box-shadow:0 18px 40px -12px rgba(0,0,0,.6)}
.vcp-pop h4{margin:0 0 6px;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--mut2)}
.vcp-pop h4+div{margin-bottom:12px}.vcp-pop div:last-child{margin-bottom:0}
.vcp-pop .vcp-mso{padding:5px 6px;border-radius:6px}

.vcp-t{min-width:900px}.vcp-t.w720{min-width:720px}.vcp-t.w640{min-width:640px}
.vcp-t th.c,.vcp-t td.c{text-align:center}.vcp-t th.c .vcp-sh{justify-content:center}
.vcp-sh{display:inline-flex;align-items:center;justify-content:flex-end;gap:3px;width:100%;border:0;background:none;padding:0;font:inherit;letter-spacing:inherit;
  text-transform:inherit;color:inherit;cursor:pointer}
.vcp-sh:hover,.vcp-sh.on{color:var(--ink)}.vcp-sh small{font-size:9px}
.vcp-t tbody tr.go{cursor:pointer}
.vcp-t td.nm{font-weight:700;color:var(--ink)}.vcp-t td.mut{font-size:12px;color:var(--mut)}
.vcp-t td.b{font-weight:700;font-variant-numeric:tabular-nums}.vcp-t td.xb{font-weight:800;font-variant-numeric:tabular-nums}
.vcn .c-lv{color:var(--lv)}.vcn .c-cy{color:var(--cy)}.vcn .c-pk{color:var(--pink)}.vcn .c-a{color:var(--a)}.vcn .c-gr{color:var(--gr)}.vcn .c-mut{color:var(--mut2)}
.vcp-small{font-size:11px;font-weight:600;color:var(--mut2)}
.vcp-under{display:block;font-size:11px;font-weight:600;color:var(--a)}
.vcp-chev{color:var(--mut2)}
.vcp-cat{display:inline-flex;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;background:var(--hov);color:var(--mut)}
.vcp-cat.on{background:color-mix(in srgb,var(--a) 10%,transparent);color:var(--a)}
.vcp-tgt{display:inline-flex;flex-direction:column;align-items:center;line-height:1.2;border:0;background:none;padding:2px 6px;border-radius:6px;color:var(--ink);font:inherit;cursor:text}
.vcp-tgt:hover{background:var(--hov)}.vcp-tgt b{font-size:14px;font-variant-numeric:tabular-nums}.vcp-tgt small{font-size:10px;font-weight:600;color:var(--mut2)}
.vcp-tgt small.hit{color:var(--gr)}
.vcp-tin{width:88px;text-align:center;min-height:30px;padding:2px 6px;border-radius:6px;border:1px solid color-mix(in srgb,var(--a) 60%,transparent);background:var(--in2);
  color:var(--ink);font:700 14px var(--ui);font-variant-numeric:tabular-nums}

.vcp-jt{min-width:960px}.vcp-jt th,.vcp-jt td{padding:8px 10px}
.vcp-jt th{letter-spacing:.06em}.vcp-jt .st{position:sticky;left:0;z-index:2;background:#14112b}
.vcp-jt thead .st{background:#1a1636}.vcp-jt .br{border-right:1px solid var(--line)}
.vcp-jt .tot{color:#ff9b73;background:rgba(216,90,48,.10)}
.vcp-jt td.z{color:var(--mut2)}
.vcp-jt tr.sum{background:var(--hov);border-top:2px solid var(--line2,rgba(170,160,255,.3))}.vcp-jt tr.sum td{font-weight:700}
.vcp-jt tr.sum .st{background:#1a1636}
.vcp-cl{display:inline-flex;flex-direction:column;line-height:1.15}.vcp-cl small{font-size:10px;color:var(--mut2);font-weight:400}

.vcp-ov{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;background:rgba(4,3,14,.55);backdrop-filter:blur(4px)}
.vcp-ov.l2{z-index:85}.vcp-ov.l3{z-index:90}
.vcp-md{display:flex;flex-direction:column;overflow:hidden;width:100%;height:100dvh;background:#120f28;color:var(--ink);border:1px solid var(--line2,rgba(170,160,255,.22));
  box-shadow:0 30px 80px -20px rgba(0,0,0,.7);font-family:var(--ui)}
@media (min-width:768px){.vcp-md{width:85vw;height:88vh;border-radius:18px}.vcp-md.mid{width:80vw;height:auto;max-height:85vh}.vcp-md.big{width:88vw}}
.vcp-mh{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:16px 24px;border-bottom:1px solid var(--line)}
.vcp-eb{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--k,var(--a))}
.vcp-back{display:inline-flex;align-items:center;gap:4px;border:0;background:none;padding:0;color:inherit;font:inherit;letter-spacing:inherit;text-transform:inherit;cursor:pointer}
.vcp-back:hover{text-decoration:underline}
.vcp-mt{margin-top:4px;font-family:var(--h);font-size:22px;font-weight:800;letter-spacing:-.01em}
.vcp-ms2{margin-top:4px;font-size:12px;font-weight:600;color:var(--mut);font-variant-numeric:tabular-nums}
.vcp-mb{flex:1;min-height:0;overflow:auto}
.vcp-split{display:grid;grid-template-columns:1fr;min-height:100%}
@media (min-width:1024px){.vcp-split{grid-template-columns:1fr 320px;height:100%}.vcp-split>div{overflow:auto}.vcp-split>div:first-child{border-right:1px solid var(--line)}}
.vcp-md .vcn-t thead{position:sticky;top:0;z-index:3}.vcp-md .vcn-t thead tr{background:#1a1636}
.vcp-md .vcn-t td{font-size:12.5px}
.vcp-stg{padding:16px}
.vcp-sth{display:flex;align-items:center;gap:8px;margin-bottom:12px;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--mut)}
.vcp-sth svg{color:var(--a)}
.vcp-sr{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;margin-bottom:6px;padding:8px 12px;border-radius:9px;border:1px solid var(--line);
  border-left:3px solid var(--k,var(--a));background:var(--hov);color:var(--ink);font:inherit;text-align:left}
.vcp-sr span:first-child{font-size:12.5px;font-weight:600;color:color-mix(in srgb,var(--ink) 85%,transparent)}
.vcp-sr b{font-size:15px;font-weight:800;font-variant-numeric:tabular-nums}
button.vcp-sr{cursor:pointer;padding:12px 16px}button.vcp-sr:hover{border-color:rgba(170,160,255,.32)}
.vcp-pct{display:inline-flex;justify-content:center;min-width:62px;padding:4px 10px;border-radius:7px;font-size:15px;font-weight:800;font-variant-numeric:tabular-nums;
  color:var(--k);background:color-mix(in srgb,var(--k) 10%,transparent)}
.vcp-srr{display:flex;align-items:center;gap:16px}.vcp-srr b{min-width:44px;text-align:right;font-size:18px}
.vcp-stl{max-width:640px;margin:0 auto;padding:16px}
.vcp-load{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;height:100%;min-height:240px;color:var(--mut);font-size:13.5px}
.vcp-load svg{width:26px;height:26px;color:var(--k,var(--a))}
.vcp-trunc{margin:10px 16px 0;padding:8px 12px;border-radius:9px;font-size:12px;color:var(--mut);background:color-mix(in srgb,var(--a) 6%,transparent);
  border:1px solid color-mix(in srgb,var(--a) 25%,transparent)}
@media (max-width:760px){.vcp-mh{padding:14px 16px}.vcp-mt{font-size:19px}.vcp-ch{padding:12px 14px}}
`;
