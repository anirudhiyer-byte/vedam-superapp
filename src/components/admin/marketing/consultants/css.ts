/**
 * Consultant Listing styles (prefix vcn-). Colours and fonts come from the staging shell tokens
 * (--ink, --mut, --panel, --line, --orange, --violet, --cyan, --green; Outfit / Inter / JetBrains Mono).
 * Accent = --orange, the CRM's Consultants accent. Layout follows the CRM page.
 */
export const CSS = `
.vcn{--a:var(--orange,#f97d03);--pink:#e80074;--lv:var(--violet,#8a18ff);--cy:var(--cyan,#00cfe5);--gr:#00b85c;
  --h:var(--font-outfit),'Outfit',var(--display),system-ui,sans-serif;--ui:var(--font-inter),'Inter',var(--font),system-ui,sans-serif;
  --code:var(--font-jetbrains),'JetBrains Mono',var(--mono),monospace;--in:rgba(130,150,255,.06);--in2:rgba(130,150,255,.1);--hov:rgba(170,160,255,.06);
  --tap:36px;--ttap:30px;height:100%;overflow:auto;color:var(--ink);font-family:var(--ui);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}
@media (pointer:coarse),(max-width:760px){.vcn{--tap:44px;--ttap:44px}}
.vcn *{box-sizing:border-box}
.vcn :focus-visible{outline:2px solid color-mix(in srgb,var(--a) 75%,transparent);outline-offset:2px;border-radius:6px}
.vcn-page{padding:28px 32px 64px;max-width:1720px}
.vcn-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.vcn-ico{width:16px;height:16px;flex-shrink:0;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.vcn-ico.s{width:14px;height:14px}.vcn-ico.xs{width:12px;height:12px}
.vcn-spin{animation:vcn-spin 1s linear infinite}@keyframes vcn-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.vcn-spin{animation:none}}

.vcn-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:24px}
.vcn-h1{font-family:var(--h);font-weight:700;font-size:44px;line-height:1.05;letter-spacing:-.025em;margin:0;
  background:linear-gradient(135deg,var(--a),color-mix(in srgb,var(--a) 60%,transparent));-webkit-background-clip:text;background-clip:text;color:transparent}
.vcn-sub{margin:8px 0 0;font-size:13.5px;font-weight:500;color:var(--mut);display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px}
.vcn-sub i{font-style:normal;color:var(--mut2);display:inline-flex;align-items:center;gap:4px}
.vcn-tools{display:flex;flex-wrap:wrap;gap:8px}
.vcn-tb{display:inline-flex;align-items:center;gap:8px;min-height:max(40px,var(--tap));padding:9px 16px;border-radius:12px;font:600 13.5px var(--ui);cursor:pointer;
  border:1px solid var(--line);background:var(--panel);color:var(--mut);transition:background-color .15s,color .15s,border-color .15s,opacity .15s;white-space:nowrap}
.vcn-tb:hover{background:var(--hov);color:var(--ink)}
.vcn-tb.pri{background:var(--a);border-color:var(--a);color:#fff}.vcn-tb.pri:hover{opacity:.9;background:var(--a)}
.vcn-tb:disabled{opacity:.55;cursor:default}

.vcn-filters{display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px;margin-bottom:12px}
.vcn-search{flex:1;min-width:220px;position:relative}
.vcn-search svg{position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--mut2);pointer-events:none}
.vcn-in,.vcn-sel{min-height:var(--tap);padding:7px 12px;border-radius:9px;border:1px solid var(--line2,rgba(170,160,255,.22));background:var(--in);color:var(--ink);
  font:400 13.5px var(--ui);outline:none;transition:border-color .15s,background-color .15s}
.vcn-in:hover,.vcn-sel:hover{border-color:rgba(170,160,255,.32)}
.vcn-in:focus,.vcn-sel:focus{border-color:color-mix(in srgb,var(--a) 70%,transparent);background:var(--in2)}
.vcn-in::placeholder{color:var(--mut2)}
.vcn-sel{color-scheme:dark;cursor:pointer}.vcn-sel option{background:#14122b;color:#f5f3ff}
.vcn-search .vcn-in{width:100%;padding-left:34px}
.vcn-sbtn{display:inline-flex;align-items:center;gap:6px;min-height:var(--tap);padding:7px 12px;border-radius:9px;border:1px solid var(--line2,rgba(170,160,255,.22));
  background:var(--in);color:var(--mut);font:500 13.5px var(--ui);cursor:pointer;white-space:nowrap;transition:background-color .15s,color .15s}
.vcn-sbtn:hover{background:var(--hov);color:var(--ink)}.vcn-sbtn:disabled{opacity:.55;cursor:default}
.vcn-sbtn.acc{border-color:color-mix(in srgb,var(--a) 34%,transparent);color:var(--ink);font-weight:600;border-radius:12px;padding:7px 16px}
.vcn-sbtn.acc svg{color:var(--a)}
.vcn-grow{flex:1}

.vcn-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:22px}
@media (min-width:640px){.vcn-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (min-width:1180px){.vcn-kpis{grid-template-columns:repeat(7,minmax(0,1fr))}}
.vcn-kpi{position:relative;overflow:hidden;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:12px 14px;min-width:0;
  box-shadow:0 10px 30px -10px color-mix(in srgb,var(--k) 19%,transparent)}
@media (min-width:768px){.vcn-kpi{padding:16px}}
.vcn-kpi::before{content:"";position:absolute;top:0;left:0;right:0;height:1px;opacity:.6;background:linear-gradient(90deg,transparent,var(--k),transparent)}
.vcn-kpi.hl{outline:1px solid color-mix(in srgb,var(--k) 25%,transparent);outline-offset:-1px}
.vcn-kpi-l{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--mut);margin-bottom:8px}
.vcn-kpi-v{font-family:var(--h);font-weight:700;font-size:15px;line-height:1.15;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  background:linear-gradient(135deg,var(--k),color-mix(in srgb,var(--k) 67%,transparent));-webkit-background-clip:text;background-clip:text;color:transparent}
@media (min-width:640px){.vcn-kpi-v{font-size:17px}}@media (min-width:1180px){.vcn-kpi-v{font-size:19px}}@media (min-width:1440px){.vcn-kpi-v{font-size:22px}}
.vcn-kpi-s{font-size:10.5px;font-weight:500;color:var(--mut2);margin-top:4px;font-variant-numeric:tabular-nums}
.vcn-kpi-v.ld{color:var(--mut2);background:none;-webkit-text-fill-color:currentColor}

.vcn-tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin-bottom:16px}
.vcn-tab{position:relative;padding:10px 16px;min-height:var(--tap);border:0;border-bottom:2px solid transparent;margin-bottom:-1px;background:none;color:var(--mut);
  font:600 13.5px var(--ui);cursor:pointer;transition:color .15s}
.vcn-tab:hover{color:var(--ink)}.vcn-tab[aria-selected="true"]{color:var(--a);border-bottom-color:var(--a)}
.vcn-badge{margin-left:8px;padding:2px 6px;border-radius:6px;font-size:10px;font-weight:700;background:var(--hov);color:var(--mut)}
.vcn-tab[aria-selected="true"] .vcn-badge{background:color-mix(in srgb,var(--a) 13%,transparent);color:var(--a)}

.vcn-hidbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:12px}
.vcn-chip{display:inline-flex;align-items:center;gap:8px;min-height:var(--tap);padding:6px 12px;border-radius:8px;border:1px solid var(--line);background:var(--panel);
  color:var(--mut);font:600 12px var(--ui);cursor:pointer;transition:background-color .15s,color .15s}
.vcn-chip:hover{background:var(--hov);color:var(--ink)}
.vcn-lnk{background:none;border:0;color:var(--mut2);font:500 12px var(--ui);cursor:pointer;padding:6px 4px;min-height:var(--tap)}
.vcn-lnk:hover{color:var(--ink);text-decoration:underline}.vcn-lnk:disabled{opacity:.5}

.vcn-bulk{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-bottom:16px;padding:10px 14px;border-radius:12px;
  border:1px solid color-mix(in srgb,var(--a) 25%,transparent);background:var(--panel)}
.vcn-bulk-l{display:flex;align-items:center;gap:10px;font-size:13.5px;font-weight:600}
.vcn-bulk-r{display:flex;flex-wrap:wrap;gap:8px}
.vcn-x{display:inline-flex;align-items:center;justify-content:center;min-width:var(--tap);min-height:var(--tap);border:0;border-radius:8px;background:none;color:var(--mut2);cursor:pointer}
.vcn-x:hover{color:var(--ink);background:var(--hov)}
.vcn-b{display:inline-flex;align-items:center;gap:8px;min-height:var(--tap);padding:6px 12px;border-radius:9px;font:600 13px var(--ui);cursor:pointer;
  border:1px solid var(--line);background:none;color:var(--ink);transition:background-color .15s,opacity .15s;white-space:nowrap}
.vcn-b:hover{background:var(--hov)}.vcn-b:disabled{opacity:.5;cursor:default}
.vcn-b.dan{background:var(--pink);border-color:var(--pink);color:#fff}.vcn-b.dan:hover{opacity:.9;background:var(--pink)}
.vcn-b.acc{background:var(--a);border-color:var(--a);color:#fff}.vcn-b.acc:hover{opacity:.9;background:var(--a)}

.vcn-note{display:flex;gap:12px;align-items:flex-start;margin-bottom:16px;padding:12px 16px;border-radius:12px;font-size:13.5px;line-height:1.6;color:var(--mut);
  background:color-mix(in srgb,var(--a) 6%,transparent);border:1px solid color-mix(in srgb,var(--a) 25%,transparent)}
.vcn-note::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--a);margin-top:7px;flex-shrink:0}
.vcn-tip{font-size:11.5px;font-style:italic;color:var(--mut2);margin-bottom:8px}

.vcn-banner{display:flex;align-items:flex-start;gap:10px;margin-bottom:14px;padding:10px 14px;border-radius:12px;font-size:13.5px;line-height:1.5;white-space:pre-line}
.vcn-banner.err{background:color-mix(in srgb,var(--pink) 10%,transparent);border:1px solid color-mix(in srgb,var(--pink) 40%,transparent);color:#ffd4e6}
.vcn-banner.ok{background:rgba(43,217,159,.1);border:1px solid rgba(43,217,159,.32);color:var(--green)}
.vcn-banner>div{flex:1}.vcn-banner .vcn-x{min-width:28px;min-height:28px;margin:-4px -6px -4px 0}

.vcn-card{background:var(--panel);border:1px solid var(--line);border-radius:16px;overflow:hidden}
.vcn-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
.vcn-t{width:100%;min-width:900px;border-collapse:collapse}
.vcn-t thead tr{background:var(--hov);border-bottom:2px solid var(--line2,rgba(170,160,255,.22))}
.vcn-t th{text-align:left;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);padding:10px 14px;white-space:nowrap;position:relative}
.vcn-t th.chk,.vcn-t td.chk{width:40px;padding:10px 12px}
.vcn-t th.hid,.vcn-t td.hid{color:var(--mut2);background:rgba(170,160,255,.025);border-left:1px dashed var(--line2,rgba(170,160,255,.22))}
.vcn-t th.drag{cursor:move}.vcn-t th.dragging{opacity:.4}.vcn-t th.over{box-shadow:inset 3px 0 0 var(--a)}
.vcn-th{display:flex;align-items:center;gap:6px}
.vcn-req{color:var(--pink)}.vcn-auto{color:var(--mut2);font-size:10px;text-transform:none;letter-spacing:0;font-weight:500}
.vcn-grip{color:var(--mut2);opacity:0;transition:opacity .15s}
.vcn-hb{display:inline-flex;align-items:center;justify-content:center;min-width:22px;min-height:22px;padding:2px;border:0;border-radius:5px;background:none;color:var(--mut2);cursor:pointer;
  opacity:.35;transition:opacity .15s,color .15s}
.vcn-hb:hover{color:var(--ink)}.vcn-hb.on{opacity:1;color:var(--a)}
.vcn-t th:hover .vcn-grip,.vcn-t th:hover .vcn-hb,.vcn-t th:focus-within .vcn-hb,.vcn-hb[aria-expanded="true"]{opacity:1}
@media (hover:none){.vcn-hb{opacity:1;min-width:32px;min-height:32px}.vcn-grip{display:none}}
.vcn-menuw{position:relative;margin-left:auto}
.vcn-menu{position:absolute;right:0;top:calc(100% + 4px);z-index:30;min-width:180px;padding:4px 0;border-radius:10px;border:1px solid var(--line2,rgba(170,160,255,.22));
  background:#15122d;box-shadow:0 18px 40px -12px rgba(0,0,0,.6);text-transform:none;letter-spacing:0}
.vcn-mi{display:flex;width:100%;align-items:center;gap:8px;padding:8px 12px;min-height:max(34px,var(--tap));border:0;background:none;color:var(--ink);font:500 12.5px var(--ui);
  text-align:left;cursor:pointer}
.vcn-mi:hover,.vcn-mi:focus-visible{background:var(--hov);outline:none}
.vcn-mi.dan{color:var(--pink)}.vcn-mi:disabled{color:var(--mut2);cursor:not-allowed;background:none}
.vcn-mi-sep{height:1px;background:var(--line);margin:4px 0}
.vcn-t tbody tr{border-bottom:1px solid var(--line);transition:background-color .12s}
.vcn-t tbody tr:last-child{border-bottom:0}
.vcn-t tbody tr:hover,.vcn-t tbody tr.sel{background:var(--hov)}
.vcn-t td{padding:10px 14px;font-size:13.5px;white-space:nowrap;color:color-mix(in srgb,var(--ink) 92%,transparent)}
.vcn-t td:has(.vcn-ecm),.vcn-t th:has(.vcn-menu){z-index:5}
.vcn-t td.r,.vcn-t th.r{text-align:right}.vcn-t td.r .vcn-th,.vcn-t th.r .vcn-th{justify-content:flex-end}
.vcn-t td.act{text-align:right}
.vcn-num{font-variant-numeric:tabular-nums;font-weight:500}
.vcn-via{display:flex;flex-direction:column;line-height:1.2}.vcn-via small{font-size:10px;font-style:italic;color:var(--mut2)}
.vcn-t td.r .vcn-via{align-items:flex-end}
.vcn-dash{color:var(--mut2)}
.vcn-url{display:inline-flex;align-items:center;gap:4px;max-width:240px;color:var(--a);text-decoration:none}
.vcn-url span{overflow:hidden;text-overflow:ellipsis;font-family:var(--code);font-size:12.5px}
.vcn-url:hover{text-decoration:underline}
.vcn-ab{display:inline-flex;align-items:center;gap:6px;min-height:var(--ttap);padding:5px 10px;border-radius:7px;border:1px solid var(--line);background:none;
  color:var(--mut);font:500 12px var(--ui);cursor:pointer;transition:background-color .15s,color .15s}
.vcn-ab:hover{color:var(--ink);background:var(--panel)}.vcn-ab:disabled{opacity:.5;cursor:default}
.vcn-ab.dan{color:var(--pink);border-color:color-mix(in srgb,var(--pink) 30%,transparent)}.vcn-ab.dan:hover{background:color-mix(in srgb,var(--pink) 10%,transparent)}
.vcn-ab.res{font-weight:600}
.vcn-acts{display:inline-flex;gap:4px}

.vcn-ec{position:relative;display:inline-block}
.vcn-t td:has(.vcn-ecm){position:relative}
.vcn-ecb{display:inline-flex;align-items:center;justify-content:space-between;gap:6px;min-width:80px;min-height:var(--ttap);padding:4px 10px;border-radius:7px;
  border:1px solid color-mix(in srgb,var(--a) 20%,transparent);background:var(--panel);font:600 12px var(--ui);color:var(--mut);cursor:pointer;transition:background-color .15s}
.vcn-ecb:hover{background:var(--hov)}.vcn-ecb:disabled{opacity:.6;cursor:default}.vcn-ecb.pos{color:#10b981}.vcn-ecb.emp{color:var(--mut2)}
.vcn-ecm{position:absolute;z-index:40;left:0;top:calc(100% + 4px);min-width:150px;border-radius:9px;border:1px solid color-mix(in srgb,var(--a) 33%,transparent);
  background:#15122d;box-shadow:0 18px 40px -12px rgba(0,0,0,.6);overflow:hidden}
.vcn-eco{display:flex;width:100%;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;min-height:max(32px,var(--tap));border:0;background:none;
  font:600 12px var(--ui);color:var(--ink);cursor:pointer;text-align:left}
.vcn-eco:hover,.vcn-eco:focus-visible{background:var(--hov);outline:none}.vcn-eco.pos{color:#10b981}.vcn-eco svg{color:var(--a)}
.vcn-eco.clr{color:var(--mut2);border-top:1px solid var(--line);justify-content:flex-start}

.vcn-empty{padding:64px 16px;text-align:center;color:var(--mut)}
.vcn-empty b{display:block;font-size:15px;font-weight:500;color:var(--mut)}.vcn-empty span{display:block;font-size:13.5px;margin-top:4px}
.vcn-empty em{font-style:normal;font-weight:600;color:var(--a)}
.vcn-skel td{padding:14px}.vcn-skel i{display:block;height:12px;border-radius:6px;background:linear-gradient(90deg,var(--hov),rgba(170,160,255,.12),var(--hov));
  background-size:200% 100%;animation:vcn-sh 1.2s ease-in-out infinite}
@keyframes vcn-sh{to{background-position:-200% 0}}@media (prefers-reduced-motion:reduce){.vcn-skel i{animation:none}}

.vcn-pg{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;border-top:1px solid var(--line);font-size:12px;color:var(--mut2)}
.vcn-pg-l,.vcn-pg-r{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.vcn-pg .vcn-sel{min-height:max(28px,var(--tap));padding:3px 8px;font-size:12px}
.vcn-pg-n{font-variant-numeric:tabular-nums;padding:0 8px;color:var(--mut)}
.vcn-pb{display:inline-flex;align-items:center;justify-content:center;min-width:max(28px,var(--tap));min-height:max(28px,var(--tap));border:1px solid var(--line);border-radius:7px;
  background:none;color:var(--mut);cursor:pointer}
.vcn-pb:hover{color:var(--ink);background:var(--hov)}.vcn-pb:disabled{opacity:.4;cursor:default;background:none}

.vcn-ov{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(4,3,14,.55);backdrop-filter:blur(4px)}
.vcn-dlg{width:100%;max-width:520px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;border-radius:18px;border:1px solid var(--line2,rgba(170,160,255,.22));
  background:#120f28;color:var(--ink);box-shadow:0 30px 80px -20px rgba(0,0,0,.7);font-family:var(--ui)}
.vcn-dlg.wide{max-width:640px}.vcn-dlg.xl{max-width:860px}
.vcn-dh{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 22px;border-bottom:1px solid var(--line)}
.vcn-dh h2{margin:0;font-family:var(--h);font-size:20px;font-weight:700;letter-spacing:-.01em}
.vcn-dh h2.g{background:linear-gradient(135deg,var(--a),color-mix(in srgb,var(--a) 60%,transparent));-webkit-background-clip:text;background-clip:text;color:transparent}
.vcn-dh p{margin:2px 0 0;font-size:12px;color:var(--mut)}
.vcn-db{flex:1;overflow-y:auto;padding:18px 22px;display:flex;flex-direction:column;gap:16px;font-size:13.5px;line-height:1.55}
.vcn-df{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:8px;padding:14px 22px;border-top:1px solid var(--line);background:rgba(170,160,255,.03)}
.vcn-fl{display:block;font-size:11.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);margin-bottom:6px}
.vcn-db .vcn-in,.vcn-db .vcn-sel{width:100%}
.vcn-db .vcn-in.bad{border-color:var(--pink)}
.vcn-fe{font-size:12px;color:var(--pink);margin-top:5px}
.vcn-fh{font-size:12px;color:var(--mut2);margin-top:5px}
.vcn-ghost{min-height:max(36px,var(--tap));padding:8px 16px;border-radius:9px;border:0;background:none;color:var(--mut);font:500 13.5px var(--ui);cursor:pointer}
.vcn-ghost:hover{color:var(--ink);background:var(--in)}
.vcn-drop{width:100%;padding:44px 16px;border:2px dashed var(--line2,rgba(170,160,255,.22));border-radius:14px;background:none;color:var(--ink);text-align:center;cursor:pointer;
  font-family:var(--ui);transition:border-color .15s}
.vcn-drop:hover{border-color:rgba(170,160,255,.4)}.vcn-drop b{display:block;font-size:15px;margin-top:10px}.vcn-drop span{font-size:12px;color:var(--mut)}
.vcn-map{width:100%;border-collapse:collapse;font-size:13px}
.vcn-map th{text-align:left;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);padding:8px 10px;border-bottom:1px solid var(--line)}
.vcn-map td{padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:middle}
.vcn-map td.h{font-family:var(--code);font-size:12px}.vcn-map td.s{color:var(--mut);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vcn-map .vcn-sel{min-height:max(32px,var(--tap));padding:4px 8px;font-size:12.5px}
.vcn-mapc{display:flex;gap:6px}.vcn-mapc .vcn-sel:first-child{flex:1;min-width:0}
.vcn-radio{display:flex;align-items:flex-start;gap:10px;padding:6px 0;cursor:pointer}
.vcn-radio input{margin-top:3px;accent-color:var(--a);width:16px;height:16px}
.vcn-radio small{display:block;color:var(--mut2);font-size:12px}
.vcn-errlist{margin:8px 0 0;padding-left:18px;font-family:var(--code);font-size:12px;max-height:160px;overflow:auto}
.vcn-chk{accent-color:var(--lv);width:16px;height:16px;cursor:pointer}
.vcn-combo{position:relative}

@media (max-width:760px){
  .vcn-page{padding:18px 16px 48px}
  .vcn-h1{font-size:32px}
  .vcn-head{margin-bottom:18px}
  .vcn-tools{width:100%}.vcn-tools .vcn-tb{flex:1 1 auto;justify-content:center}
  .vcn-search{min-width:100%}
  .vcn-filters .vcn-sel{flex:1 1 140px}
  .vcn-grow{display:none}
  .vcn-dlg{max-height:94vh;border-radius:16px}
  .vcn-dh,.vcn-db,.vcn-df{padding-left:16px;padding-right:16px}
  .vcn-df>*{flex:1 1 auto}
}
`;
