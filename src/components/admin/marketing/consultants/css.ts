/**
 * Consultant Listing styles (prefix vcn-). The values are the vedamcrm360 Consultants Listing in its dark theme
 * (its --vd-* tokens, Outfit everywhere, Tailwind sizes: radius md 8 · lg 10 · xl 14 · 2xl 16, text-sm 14 / xs 12).
 * Accent = #F97D03 (orange), the CRM's Consultants accent. The old variable names (--ink, --mut, --line, --in, --hov …)
 * stay defined because Consultant Performance (perf-*.tsx) uses them too.
 */
export const CSS = `
.vcn{--a:#f97d03;--pink:#e80074;--lv:#8a18ff;--cy:#00cfe5;--gr:#00b85c;
  --fg:#fff;--fg80:#ffffffcc;--fg70:#ffffffb3;--fg60:#ffffff99;--fg50:#ffffff80;--fg40:#ffffff66;
  --surf:#ffffff08;--surfh:#ffffff14;--inp:#ffffff0d;--bd:#ffffff1a;--bds:#fff3;--modal:#0a0628f2;--menu:#110d2e;
  --ink:var(--fg);--mut:var(--fg70);--mut2:var(--fg60);--panel:var(--surf);--line:var(--bd);--line2:var(--bds);--in:var(--inp);--in2:var(--surfh);--hov:var(--surfh);
  --h:var(--font-outfit,'Outfit'),'Outfit',system-ui,sans-serif;--ui:var(--font-outfit,'Outfit'),'Outfit',system-ui,sans-serif;
  --code:var(--font-jetbrains,'JetBrains Mono'),'JetBrains Mono',ui-monospace,monospace;
  --tap:36px;--ttap:30px;height:100%;overflow:auto;color:var(--fg);font-family:var(--ui);font-size:16px;line-height:1.5;-webkit-font-smoothing:antialiased}
@media (pointer:coarse),(max-width:760px){.vcn{--tap:44px;--ttap:44px}}
.vcn *{box-sizing:border-box}
.vcn button,.vcn input,.vcn select,.vcn textarea{font-family:inherit}
.vcn :focus-visible{outline:2px solid color-mix(in srgb,var(--a) 75%,transparent);outline-offset:2px}
.vcn-page{padding:16px 16px 32px}
@media (min-width:768px){.vcn-page{padding:40px}}
.vcn-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.vcn-ico{width:16px;height:16px;flex-shrink:0;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.vcn-ico.s{width:14px;height:14px}.vcn-ico.xs{width:12px;height:12px}.vcn-ico.l{width:20px;height:20px}.vcn-ico.x4{width:40px;height:40px}.vcn-ico.x5{width:48px;height:48px}
.vcn-spin{animation:vcn-spin 1s linear infinite}@keyframes vcn-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.vcn-spin{animation:none}}

/* header */
.vcn-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:24px}
.vcn-h1{font-family:var(--h);font-weight:700;font-size:48px;line-height:1;letter-spacing:-.025em;margin:0;
  background:linear-gradient(to bottom right,var(--a),#f97d0399);-webkit-background-clip:text;background-clip:text;color:transparent}
.vcn-sub{margin:8px 0 0;font-size:14px;line-height:20px;font-weight:500;color:var(--fg70)}
.vcn-sub i{font-style:normal;color:var(--fg60);display:inline-flex;align-items:center;gap:4px}
.vcn-sub i.sv{margin-left:8px}
.vcn-tools{display:flex;flex-wrap:wrap;gap:8px}
.vcn-tb{display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:14px;font:600 14px/20px var(--ui);cursor:pointer;
  border:1px solid var(--bd);background:var(--surf);color:var(--fg70);transition:background-color .15s,color .15s,opacity .15s}
.vcn-tb:hover{background:var(--surfh)}
.vcn-tb.pri{background:var(--a);border-color:transparent;color:#fff}.vcn-tb.pri:hover{opacity:.9;background:var(--a)}
.vcn-tb:disabled{opacity:.7;cursor:not-allowed}.vcn-tb.pri:disabled{opacity:.5}

/* filters */
.vcn-filters{display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px}
@media (min-width:768px){.vcn-filters{gap:12px}}
.vcn-search{flex:1 1 0%;min-width:100%;position:relative}
@media (min-width:640px){.vcn-search{min-width:220px}}
.vcn-search svg{position:absolute;left:12px;top:50%;transform:translateY(-50%);width:16px;height:16px;color:var(--fg40);pointer-events:none}
.vcn-in,.vcn-sel{height:36px;padding:0 12px;border-radius:8px;border:1px solid var(--bd);background:var(--inp);color:var(--fg);font:400 14px/20px var(--ui);outline:none}
.vcn-in{padding:8px 12px}
.vcn-in::placeholder{color:var(--fg40)}
.vcn-search .vcn-in{width:100%;padding-left:36px}
.vcn-in:focus,.vcn-sel:focus{box-shadow:0 0 0 2px #8a18ff80}
.vcn-sel{color-scheme:dark;cursor:pointer}.vcn-sel option{background:#14122b;color:#fff}
.vcn-sbtn{display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 12px;border-radius:8px;border:1px solid var(--bd);background:var(--inp);
  color:var(--fg70);font:500 14px/20px var(--ui);cursor:pointer;white-space:nowrap}
.vcn-sbtn:hover{background:var(--surfh);color:var(--fg)}.vcn-sbtn:disabled{opacity:.6;cursor:not-allowed}
.vcn-sbtn.acc{height:auto;padding:8px 16px;gap:8px;border-radius:14px;border-color:#f97d0355;background:var(--surf);color:var(--fg);font-weight:600}
.vcn-sbtn.acc:hover{background:var(--surfh)}.vcn-sbtn.acc svg{color:var(--a)}
.vcn-grow{flex:1 1 0%}
.vcn-top{margin-bottom:20px}.vcn-top>*+*{margin-top:12px}

/* KPI cards */
.vcn-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
@media (min-width:640px){.vcn-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (min-width:1024px){.vcn-kpis{grid-template-columns:repeat(7,minmax(0,1fr))}}
.vcn-kpi{position:relative;overflow:hidden;background:var(--surf);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border:1px solid var(--bd);border-radius:16px;padding:12px;min-width:0;
  box-shadow:0 10px 30px -10px color-mix(in srgb,var(--k) 19%,transparent)}
@media (min-width:768px){.vcn-kpi{padding:16px}}
.vcn-kpi::before{content:"";position:absolute;top:0;left:0;right:0;height:1px;opacity:.6;background:linear-gradient(90deg,transparent,var(--k),transparent)}
.vcn-kpi.hl{outline:1px solid color-mix(in srgb,var(--k) 25%,transparent);outline-offset:-1px}
.vcn-kpi-l{font-size:11px;line-height:16.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--fg70);margin-bottom:8px}
.vcn-kpi-v{font-family:var(--ui);font-weight:700;font-size:15px;line-height:1.25;letter-spacing:-.025em;font-variant-numeric:tabular-nums;overflow-wrap:break-word;
  background:linear-gradient(135deg,var(--k),color-mix(in srgb,var(--k) 67%,transparent));-webkit-background-clip:text;background-clip:text;color:transparent}
@media (min-width:640px){.vcn-kpi-v{font-size:17px}}@media (min-width:1024px){.vcn-kpi-v{font-size:19px}}@media (min-width:1280px){.vcn-kpi-v{font-size:22px}}
.vcn-kpi-s{font-size:10px;line-height:15px;font-weight:500;color:var(--fg60);margin-top:4px;font-variant-numeric:tabular-nums}
.vcn-kpi-v.ld{color:var(--fg40);background:none;-webkit-text-fill-color:currentColor}

/* tabs, hidden-columns bar, bulk bar, notes */
.vcn-tabs{display:flex;gap:4px;border-bottom:1px solid var(--bd);margin-bottom:16px}
.vcn-tab{position:relative;padding:10px 16px;border:0;border-bottom:2px solid transparent;background:none;color:var(--fg60);font:600 14px/20px var(--ui);cursor:pointer;transition:color .15s}
.vcn-tab:hover{color:var(--fg)}.vcn-tab[aria-selected="true"]{color:var(--a);border-bottom-color:currentColor}
.vcn-badge{margin-left:8px;padding:2px 6px;border-radius:8px;font-size:10px;line-height:14.2857px;font-weight:700;background:var(--surfh);color:var(--fg70)}
.vcn-tab:last-child .vcn-badge{color:var(--fg60)}
.vcn-tab[aria-selected="true"] .vcn-badge{background:#f97d0320;color:var(--a)}

.vcn-hidbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:12px}
.vcn-chip{display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border-radius:10px;border:1px solid var(--bd);background:var(--surf);
  color:var(--fg70);font:600 12px/16px var(--ui);cursor:pointer}
.vcn-chip:hover{background:var(--surfh);color:var(--fg)}
.vcn-lnk{background:none;border:0;color:var(--fg60);font:500 12px/16px var(--ui);cursor:pointer;padding:0}
.vcn-lnk:hover{color:var(--fg);text-decoration:underline}.vcn-lnk:disabled{opacity:.5}

.vcn-bulk{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin-bottom:16px;padding:12px;border-radius:14px;
  border:1px solid #f97d0340;background:var(--surf)}
@media (min-width:768px){.vcn-bulk{gap:12px;padding:12px 16px}}
.vcn-bulk-l{display:flex;align-items:center;gap:12px;font-size:14px;line-height:20px;font-weight:600;color:var(--fg)}
.vcn-bulk-r{display:flex;gap:8px}
.vcn-x{display:inline-flex;align-items:center;justify-content:center;padding:4px;border:0;border-radius:10px;background:none;color:var(--fg60);cursor:pointer}
.vcn-x:hover{color:var(--fg);background:var(--surfh)}
.vcn-bulk .vcn-x{border-radius:4px}
.vcn-b{display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border-radius:10px;font:600 14px/20px var(--ui);cursor:pointer;
  border:1px solid var(--bd);background:none;color:var(--fg80);white-space:nowrap}
.vcn-b:hover{background:var(--surfh);color:var(--fg)}.vcn-b:disabled{opacity:.5;cursor:default}
.vcn-b.dan{background:var(--pink);border-color:transparent;color:#fff}.vcn-b.dan:hover{opacity:.9;background:var(--pink)}
.vcn-b.acc{background:var(--a);border-color:transparent;color:#fff}.vcn-b.acc:hover{opacity:.9;background:var(--a)}

.vcn-note{display:flex;gap:12px;align-items:flex-start;margin-bottom:16px;padding:12px 16px;border-radius:14px;font-size:14px;line-height:20px;color:var(--fg70);
  background:#f97d030f;border:1px solid #f97d0340}
.vcn-note::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--a);margin-top:6px;flex-shrink:0}
.vcn-note span{line-height:1.625}
.vcn-tip{font-size:11px;line-height:16.5px;font-style:italic;color:var(--fg60);margin-bottom:8px}

/* messages that exist only on staging (the CRM uses alert()) */
.vcn-banner{display:flex;align-items:flex-start;gap:8px;margin-bottom:14px;padding:8px 12px;border-radius:10px;font-size:14px;line-height:20px;color:var(--fg);white-space:pre-line}
.vcn-banner svg{margin-top:2px}
.vcn-banner.err{background:#e8007410;border:1px solid #e8007466}.vcn-banner.err svg{color:var(--pink)}
.vcn-banner.ok{background:#00b85c14;border:1px solid #00b85c55}.vcn-banner.ok svg{color:var(--gr)}
.vcn-banner>div{flex:1}.vcn-banner .vcn-x{margin:-2px -4px -2px 0}

/* table */
/* no backdrop-filter here: it would make the menus (position:fixed) relative to the card */
.vcn-card{background:var(--surf);border:1px solid var(--bd);border-radius:16px;overflow:hidden}
.vcn-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;container-type:inline-size}
.vcn-t{width:100%;min-width:900px;border-collapse:collapse}
.vcn-t thead tr{background:var(--surfh);border-bottom:2px solid var(--bds)}
.vcn-t th{text-align:left;font-size:11px;line-height:16.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--fg70);padding:12px 16px;white-space:nowrap;position:relative}
.vcn-t th.chk,.vcn-t td.chk{width:40px;padding:12px;font-size:16px;line-height:24px}
.vcn-t th.chk{letter-spacing:normal;text-transform:none}
.vcn-t th.hid{color:var(--fg40);background:#ffffff08;border-left:1px dashed var(--bd)}
.vcn-t td.hid{color:var(--fg60);background:#ffffff05;border-left:1px dashed var(--bd)}
.vcn-t th.drag{cursor:move}.vcn-t th.dragging{opacity:.4}.vcn-t th.over{box-shadow:inset 3px 0 0 var(--a)}
.vcn-th{display:flex;align-items:center;gap:6px}
.vcn-req{color:var(--pink)}
.vcn-grip{color:var(--fg40);opacity:0;transition:opacity .15s;display:inline-flex}
.vcn-hb{display:inline-flex;align-items:center;justify-content:center;padding:2px;border:0;border-radius:4px;background:none;color:var(--fg40);cursor:pointer;
  opacity:0;transition:opacity .15s;flex-shrink:0}
.vcn-hb:hover{color:var(--fg)}.vcn-hb.on{opacity:1;color:var(--a)}
.vcn-t th:hover .vcn-grip,.vcn-t th:hover .vcn-hb,.vcn-t th:focus-within .vcn-hb,.vcn-t th:focus-within .vcn-grip,.vcn-hb[aria-expanded="true"]{opacity:1}
@media (hover:none){.vcn-hb{opacity:1;min-width:32px;min-height:32px}.vcn-grip{display:none}}
.vcn-menuw{position:relative;margin-left:auto}
.vcn-menu{position:absolute;right:0;top:calc(100% + 4px);z-index:30;min-width:160px;border-radius:10px;border:1px solid var(--bd);
  background:var(--menu);box-shadow:0 20px 25px -5px rgba(0,0,0,.4),0 8px 10px -6px rgba(0,0,0,.4);overflow:hidden;text-transform:none;letter-spacing:0}
.vcn-mi{display:flex;width:100%;align-items:center;gap:8px;padding:8px 12px;border:0;background:none;color:var(--fg80);font:500 12px/16px var(--ui);
  text-align:left;cursor:pointer}
.vcn-mi:hover,.vcn-mi:focus-visible{background:var(--surfh);outline:none}
.vcn-mi.dan{color:var(--pink)}.vcn-mi.dan:hover,.vcn-mi.dan:focus-visible{background:#e8007418}
.vcn-mi:disabled{color:var(--fg40);cursor:not-allowed;background:none}
.vcn-t tbody tr{border-bottom:1px solid var(--bd)}
.vcn-t tbody tr:last-child{border-bottom:0}
.vcn-t tbody tr:hover,.vcn-t tbody tr.sel{background:var(--surfh)}
.vcn-t td{padding:12px 16px;font-size:14px;line-height:20px;white-space:nowrap;color:var(--fg80)}
.vcn-t td:has(.vcn-ecm),.vcn-t th:has(.vcn-menu){z-index:5}
.vcn-t td.act{text-align:right}
.vcn-t th.r{text-align:right}
.vcn-num{font-variant-numeric:tabular-nums;font-weight:500}
.vcn-via{display:flex;flex-direction:column;line-height:1.25}.vcn-via small{font-size:10px;font-style:italic;color:var(--fg40)}
.vcn-dash{color:var(--fg40)}
.vcn-utm{white-space:nowrap}
.vcn-url{display:inline-flex;align-items:center;gap:4px;max-width:240px;color:var(--a);text-decoration:none}
.vcn-url span{overflow:hidden;text-overflow:ellipsis}
.vcn-url:hover{text-decoration:underline}
.vcn-ab{display:inline-flex;align-items:center;gap:4px;padding:6px 10px;border-radius:8px;border:1px solid var(--bd);background:none;
  color:var(--fg70);font:500 12px/16px var(--ui);cursor:pointer}
.vcn-ab:hover{color:var(--fg);background:var(--surf)}.vcn-ab:disabled{opacity:.5;cursor:default}
.vcn-ab.dan{color:var(--pink);border-color:#e800744d}.vcn-ab.dan:hover{background:#e800741a;color:var(--pink)}
.vcn-ab.res{font-weight:600;gap:6px;color:inherit}
.vcn-acts{display:inline-flex;align-items:center;gap:4px}
.vcn-chk{accent-color:#8a18ff;cursor:pointer}

/* inline dropdown cell */
.vcn-ec{position:relative;display:inline-block}
.vcn-t td:has(.vcn-ecm){position:relative}
.vcn-ecb{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:8px;border:1px solid #f97d0333;background:var(--surf);
  font:600 12px/17.1429px var(--ui);color:var(--fg70);cursor:pointer}
.vcn-ecb:hover{background:var(--surfh)}.vcn-ecb:disabled{opacity:.6;cursor:not-allowed}.vcn-ecb.pos{color:#10b981}.vcn-ecb.emp{color:var(--fg50)}
.vcn-ecb svg:last-child{opacity:.6}
.vcn-ecm{position:absolute;z-index:40;left:0;top:calc(100% + 4px);min-width:120px;border-radius:10px;border:1px solid #f97d0355;
  background:var(--menu);box-shadow:0 20px 25px -5px rgba(0,0,0,.4),0 8px 10px -6px rgba(0,0,0,.4);overflow:hidden}
.vcn-eco{display:flex;width:100%;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;border:0;background:none;
  font:600 12px/17.1429px var(--ui);color:var(--fg70);cursor:pointer;text-align:left}
.vcn-eco:hover,.vcn-eco:focus-visible{background:var(--surfh);outline:none}.vcn-eco.pos{color:#10b981}.vcn-eco svg{color:var(--a)}
.vcn-eco.clr{color:var(--fg60);border-top:1px solid var(--bd);justify-content:flex-start}.vcn-eco.clr svg{color:inherit}

/* the table is much wider than the screen: messages stay in the visible part (100cqi = width of .vcn-scroll) */
.vcn-t td.msg{padding:0}
.vcn-empty{position:sticky;left:0;width:100cqi;padding:64px 16px;text-align:center;color:var(--fg60)}
.vcn-empty b{display:block;font-size:16px;line-height:24px;font-weight:500}.vcn-empty span{display:block;font-size:14px;line-height:20px;margin-top:4px}
.vcn-empty em{font-style:normal;font-weight:600;color:var(--a)}
.vcn-skel td{padding:14px}.vcn-skel i{position:sticky;left:14px;max-width:calc(100cqi - 28px);display:block;height:12px;border-radius:6px;background:linear-gradient(90deg,var(--surfh),#ffffff1f,var(--surfh));
  background-size:200% 100%;animation:vcn-sh 1.2s ease-in-out infinite}
@keyframes vcn-sh{to{background-position:-200% 0}}@media (prefers-reduced-motion:reduce){.vcn-skel i{animation:none}}

.vcn-pg{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-top:1px solid var(--bd);font-size:12px;line-height:16px}
.vcn-pg-l{display:flex;align-items:center;gap:8px;color:var(--fg60)}
.vcn-pg-r{display:flex;align-items:center;gap:4px}
.vcn-pg .vcn-sel{height:28px;padding:0 8px;font-size:12px;line-height:16px}
.vcn-pg-l .vcn-pg-n{margin-left:8px}
.vcn-pg-n{font-variant-numeric:tabular-nums}
.vcn-pg-r .vcn-pg-n{padding:0 8px;color:var(--fg70)}
.vcn-pb{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;font-size:12px;border:1px solid var(--bd);border-radius:8px;background:var(--inp);color:var(--fg70);cursor:pointer}
.vcn-pb:hover{color:var(--fg);background:var(--surfh)}.vcn-pb:disabled{opacity:.4;cursor:not-allowed;background:var(--inp);color:var(--fg70)}

/* dialogs */
.vcn-ov{position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.4);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.vcn-ov.dk{background:rgba(0,0,0,.6)}.vcn-ov.nb{-webkit-backdrop-filter:none;backdrop-filter:none}.vcn-ov.z6{z-index:60}
@media (max-width:767px){.vcn-ov.fs{padding:0}}
.vcn-dlg{width:100%;max-width:448px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;border-radius:16px;border:1px solid var(--bd);
  background:linear-gradient(var(--surf),var(--surf)),#0a0628;color:var(--fg);box-shadow:0 25px 50px -12px rgba(0,0,0,.45);font-family:var(--ui)}
.vcn-dlg.lg{max-width:512px}.vcn-dlg.x2{max-width:672px}.vcn-dlg.x3{max-width:768px}
.vcn-dlg.modal{background:var(--modal)}
@media (max-width:767px){.vcn-dlg.fs{height:100dvh;max-height:100dvh;border-radius:0}}
.vcn-dlg.pad{padding:24px;display:block}
.vcn-dh{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 24px;border-bottom:1px solid var(--bd)}
.vcn-dh h2{margin:0;font-size:20px;line-height:28px;font-weight:700;color:var(--fg)}
.vcn-dh h2.g{background:linear-gradient(to bottom right,var(--a),#f97d0399);-webkit-background-clip:text;background-clip:text;color:transparent}
.vcn-dh h2.sm{font-size:18px;line-height:28px}
.vcn-dh p{margin:2px 0 0;font-size:12px;line-height:16px;color:var(--fg60)}
.vcn-db{flex:1;overflow-y:auto;padding:20px 24px;display:flex;flex-direction:column;gap:16px;font-size:14px;line-height:20px}
.vcn-db.g20{gap:20px}.vcn-db.g12{gap:12px}.vcn-db.blk{display:block}
.vcn-df{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:16px 24px;border-top:1px solid var(--bd);background:var(--surfh)}
.vcn-df.nb{border-top:0}
.vcn-df .sp{flex:1}
.vcn-fl{display:block;font-size:12px;line-height:16px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--fg70);margin-bottom:6px}
.vcn-fl.w{letter-spacing:.05em;color:var(--fg60)}
.vcn-db .vcn-fin{width:100%;height:auto;padding:8px 12px;border-radius:10px;border:1px solid var(--bd);background:var(--inp);color:var(--fg);font:400 14px/20px var(--ui);outline:none}
.vcn-db .vcn-fin::placeholder{color:var(--fg40)}
.vcn-db .vcn-fin:focus{border-color:var(--bds);box-shadow:none}
.vcn-db .vcn-fin.sf{background:var(--surf)}
.vcn-db .vcn-fin.bad{border-color:var(--pink)}
.vcn-db select.vcn-fin{color-scheme:dark;cursor:pointer}
.vcn-fe{font-size:12px;line-height:16px;color:var(--pink);margin-top:4px}
.vcn-fh{font-size:11px;line-height:16.5px;color:var(--fg60);margin-top:4px}
.vcn-fh.mono{font-family:var(--code)}
.vcn-fh.it{font-style:italic;color:var(--fg50)}
.vcn-err{display:flex;align-items:flex-start;gap:8px;padding:8px 12px;border-radius:10px;background:#e8007410;border:1px solid #e8007466;font-size:14px;line-height:20px;color:var(--fg)}
.vcn-err svg{margin-top:2px;color:var(--pink)}
.vcn-err>div{flex:1}
.vcn-errlist{margin:8px 0 0;padding:0;list-style:none;font-family:var(--code);font-size:12px;line-height:16px;max-height:160px;overflow:auto}
.vcn-errlist li+li{margin-top:4px}
.vcn-cancel{padding:8px 16px;border-radius:10px;border:0;background:none;color:var(--fg70);font:500 14px/20px var(--ui);cursor:pointer}
.vcn-cancel:hover{color:var(--fg);background:var(--inp)}.vcn-cancel.s:hover{background:var(--surf)}.vcn-cancel:disabled{opacity:.7;cursor:default}
.vcn-cancel.md{border-radius:8px}.vcn-cancel.md:hover{background:var(--surfh)}
.vcn-go{display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border-radius:10px;border:0;background:var(--a);color:#fff;font:600 14px/20px var(--ui);cursor:pointer}
.vcn-go:hover{opacity:.9}.vcn-go:disabled{opacity:.5;cursor:not-allowed}
.vcn-go.dan{background:var(--pink)}.vcn-go.md{border-radius:8px}
.vcn-back{border:0;background:none;color:var(--fg70);font:500 14px/20px var(--ui);cursor:pointer;padding:0}.vcn-back:hover{color:var(--fg)}
.vcn-cf-h{padding:20px 24px;border-bottom:1px solid var(--bd)}
.vcn-cf-t{display:flex;align-items:center;gap:12px;margin-bottom:8px}
.vcn-cf-t h2{margin:0;font-size:18px;line-height:28px;font-weight:700;color:var(--fg)}
.vcn-cf-i{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:#e8007426;color:var(--pink);flex-shrink:0}
.vcn-cf-p{margin:0;font-size:14px;line-height:1.625;color:var(--fg70)}
.vcn-cf-p b{font-weight:600;color:var(--fg)}.vcn-cf-p b.red{color:var(--pink)}
.vcn-bu-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.vcn-bu-h .vcn-x{border-radius:4px}
.vcn-bu-h h2{margin:0;font-size:18px;line-height:28px;font-weight:700;color:var(--fg)}
.vcn-bu-p{margin:0 0 16px;font-size:14px;line-height:1.625;color:var(--fg70)}
.vcn-bu-f{display:flex;justify-content:flex-end;gap:8px;margin-top:8px}
.vcn-bu-in{width:100%;height:36px;padding:0 12px;margin-bottom:4px;border-radius:8px;border:1px solid var(--bd);background:var(--inp);color:var(--fg);font:400 14px/20px var(--ui);outline:none}
.vcn-bu-in:focus{box-shadow:0 0 0 2px #8a18ff80}
.vcn-bu-in.mb{margin-bottom:16px}
.vcn-bu-in::placeholder{color:var(--fg40)}
select.vcn-bu-in{color-scheme:dark}

/* combo picker (row dialog) */
.vcn-combo{position:relative}
.vcn-cb{width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;border-radius:10px;border:1px solid var(--bd);background:var(--inp);
  color:var(--fg);font:400 14px/20px var(--ui);text-align:left;cursor:pointer}
.vcn-cb:hover{border-color:var(--bds)}.vcn-cb.bad{border-color:var(--pink)}
.vcn-cb span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.vcn-cb .ph{color:var(--fg40);font-style:italic}
.vcn-cb em{font-style:normal;margin-left:8px;font-size:10px;text-transform:uppercase;letter-spacing:.025em;color:var(--fg60)}
.vcn-cb svg{color:var(--fg60);transition:transform .15s}.vcn-cb[aria-expanded="true"] svg{transform:rotate(180deg)}
.vcn-cp{position:absolute;z-index:50;top:calc(100% + 4px);left:0;right:0;border:1px solid var(--bd);border-radius:10px;overflow:hidden;background:#0d0a2c;
  box-shadow:0 25px 50px -12px rgba(0,0,0,.5)}
.vcn-cp-s{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--bd);background:var(--inp)}
.vcn-cp-s svg{color:var(--fg60)}
.vcn-cp-s input{flex:1;background:transparent;border:0;outline:none;color:var(--fg);font:400 14px/20px var(--ui)}
.vcn-cp-s input::placeholder{color:var(--fg40)}
.vcn-cp-l{max-height:240px;overflow-y:auto}
.vcn-cp-o{display:flex;width:100%;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;border:0;background:none;color:var(--fg);font:400 14px/20px var(--ui);text-align:left;cursor:pointer}
.vcn-cp-o:hover,.vcn-cp-o:focus-visible{background:var(--surfh);outline:none}
.vcn-cp-o span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vcn-cp-o.clr{color:var(--fg70);font-style:italic;border-bottom:1px solid var(--bd)}
.vcn-cp-o.new{justify-content:flex-start;border-top:1px solid var(--bd)}.vcn-cp-o.new span{flex:1}.vcn-cp-o.new svg{color:var(--lv)}.vcn-cp-o.new b{font-weight:600}
.vcn-cp-o[aria-selected="true"] svg{color:var(--gr)}
.vcn-cp-n{padding:16px 12px;text-align:center;font-size:14px;color:var(--fg60)}

/* add column: type cards */
.vcn-types{display:flex;flex-direction:column;gap:6px}
.vcn-type{display:flex;align-items:flex-start;gap:12px;padding:10px;border-radius:10px;border:1px solid var(--bd);cursor:pointer;transition:background-color .15s,border-color .15s}
.vcn-type:hover{background:var(--surfh)}
.vcn-type.on{border-color:var(--a);background:var(--surfh)}
.vcn-type input{margin-top:2px;accent-color:var(--a)}
.vcn-type b{display:block;font-size:14px;line-height:20px;font-weight:600;color:var(--fg)}
.vcn-type span{display:block;font-size:12px;line-height:16px;color:var(--fg60);margin-top:2px}
.vcn-req-l{display:flex;align-items:center;gap:8px;cursor:pointer}
.vcn-req-l input{accent-color:var(--a);cursor:pointer}
.vcn-req-l b{font-size:14px;line-height:20px;font-weight:500;color:var(--fg)}
.vcn-req-l span{font-size:12px;line-height:16px;color:var(--fg60)}

/* csv upload */
.vcn-drop{width:100%;padding:48px;border:2px dashed var(--bd);border-radius:14px;background:none;color:var(--fg);text-align:center;cursor:pointer;font-family:var(--ui);transition:border-color .15s}
.vcn-drop:hover{border-color:var(--bds)}
.vcn-drop svg{display:block;margin:0 auto 12px;color:var(--fg40)}
.vcn-drop b{display:block;font-size:16px;line-height:24px;font-weight:600}.vcn-drop span{display:block;font-size:12px;line-height:16px;color:var(--fg60);margin-top:4px}
.vcn-rule{font-size:12px;line-height:1.625;color:var(--fg60);margin:0}.vcn-rule strong{color:var(--fg70)}
.vcn-mapbox{border:1px solid var(--bd);border-radius:14px;overflow:hidden}
.vcn-map{width:100%;min-width:560px;border-collapse:collapse;font-size:14px}
.vcn-map thead{background:var(--surfh);border-bottom:1px solid var(--bd)}
.vcn-map th{text-align:left;font-size:11px;line-height:16.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--fg70);font-weight:700;padding:10px 16px}
.vcn-map td{padding:10px 16px;border-bottom:1px solid var(--bd);vertical-align:middle}
.vcn-map tr:last-child td{border-bottom:0}
.vcn-map td.h{font-family:var(--code);font-size:12px;line-height:16px;color:var(--fg)}
.vcn-map td.s{color:var(--fg60);font-size:12px;line-height:16px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vcn-mapc{display:flex;gap:8px;align-items:center}
.vcn-mapc select{flex:1;min-width:0;padding:6px 10px;border-radius:8px;border:1px solid var(--bd);background:var(--surf);color:var(--fg);font:400 12px/16px var(--ui);color-scheme:dark}
.vcn-mapc select.ty{flex:none;width:96px}
.vcn-match{border:1px solid var(--bd);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:12px}
.vcn-match.on{border-color:#f97d0340}
.vcn-match-h{display:flex;align-items:flex-start;gap:8px}.vcn-match-h svg{margin-top:2px;color:var(--fg60)}
.vcn-match-h b{display:block;font-size:14px;line-height:20px;font-weight:600;color:var(--fg)}.vcn-match-h span{display:block;font-size:11px;line-height:1.625;color:var(--fg60);margin-top:2px}
.vcn-mrow{display:grid;grid-template-columns:1fr;gap:6px}
@media (min-width:640px){.vcn-mrow{grid-template-columns:1fr 1fr}}
.vcn-mchk{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;font-size:14px;line-height:20px;cursor:pointer;transition:background-color .15s}
.vcn-mchk:hover{background:var(--surfh)}.vcn-mchk.off{opacity:.4;cursor:not-allowed}.vcn-mchk.off:hover{background:none}
.vcn-mchk input{accent-color:var(--a)}.vcn-mchk b{font-weight:500;color:var(--fg)}
.vcn-mchk i{font-style:normal;font-size:9px;line-height:13.5px;letter-spacing:.025em;text-transform:uppercase;font-weight:700;padding:2px 6px;border-radius:4px;background:#f97d0320;color:var(--a)}
.vcn-always{display:flex;align-items:flex-start;gap:8px;padding-top:8px;border-top:1px solid var(--bd);font-size:14px;line-height:20px;font-weight:500;color:var(--fg);cursor:pointer}
.vcn-always input{accent-color:var(--a);margin-top:2px}
.vcn-always small{display:block;font-size:11px;line-height:1.625;color:var(--fg60);margin-top:2px;font-weight:400}
.vcn-pick{font-size:11px;line-height:16.5px;font-weight:500;color:var(--pink)}
.vcn-prev-t{font-size:11px;line-height:16.5px;letter-spacing:.06em;text-transform:uppercase;font-weight:600;color:var(--fg70);margin-bottom:8px}
.vcn-prev{border:1px solid var(--bd);border-radius:14px;overflow:hidden}
.vcn-prev table{width:100%;font-size:12px;line-height:16px;border-collapse:collapse}
.vcn-prev thead{background:var(--surfh);border-bottom:1px solid var(--bd)}
.vcn-prev th{text-align:left;font-size:10px;line-height:15px;text-transform:uppercase;font-weight:700;color:var(--fg70);padding:8px 12px;white-space:nowrap}
.vcn-prev td{padding:8px 12px;color:var(--fg80);white-space:nowrap;max-width:200px;overflow:hidden;text-overflow:ellipsis;border-bottom:1px solid var(--bd)}
.vcn-prev tr:last-child td{border-bottom:0}
.vcn-done{text-align:center;padding:32px 0}
.vcn-done svg{display:block;margin:0 auto 16px;color:var(--gr)}
.vcn-done h3{margin:0 0 8px;font-size:20px;line-height:28px;font-weight:700;color:var(--fg)}
.vcn-done p{margin:0;font-size:14px;line-height:20px;color:var(--fg70)}.vcn-done p+p{margin-top:4px}.vcn-done b{font-weight:600;color:var(--fg)}
.vcn-oc{font-size:12px;line-height:16px;color:var(--fg60)}
`;
