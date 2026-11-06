/**
 * Slice 4 · sanitiser break-it tests. Every output must contain ONLY the allowed tags, only the allowed
 * attributes (style / colspan / rowspan) and no on* handler, URL, comment or script — whatever the input.
 */
import { describe, expect, it } from "vitest";
import { ALLOWED_TAGS, sanitizeDocHtml, type SanitizeResult } from "./doc-sanitize";

const okHtml = (input: string): string => {
  const r = sanitizeDocHtml(input);
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
  return r.html;
};
const tagsIn = (html: string) => [...html.matchAll(/<\/?\s*([a-zA-Z][a-zA-Z0-9-]*)/g)].map((m) => m[1].toLowerCase());
const attrsIn = (html: string) => [...html.matchAll(/<[a-z0-9]+((?:\s+[^\s=>]+(?:="[^"]*")?)*)\s*\/?>/gi)]
  .flatMap((m) => [...m[1].matchAll(/\s+([^\s=>]+)/g)].map((a) => a[1].toLowerCase()));

/** the safety contract every output must meet */
function assertSafe(html: string) {
  for (const t of tagsIn(html)) expect(ALLOWED_TAGS as readonly string[], `tag <${t}> in ${html}`).toContain(t);
  for (const a of attrsIn(html)) expect(["style", "colspan", "rowspan"], `attribute ${a} in ${html}`).toContain(a);
  expect(html).not.toMatch(/<!--|<!\[|<\?/);
  expect(html).not.toMatch(/<[^>]*\son[a-z]+\s*=/i);
  expect(html).not.toMatch(/<[^>]*(?:url\s*\(|expression\s*\(|@import|javascript:|data:|\\)/i);
  // every "<" in the output starts an allowed tag; text "<" is always escaped
  expect(html.replace(/<\/?(?:p|h[1-4]|br|hr|b|strong|i|em|u|ul|ol|li|table|thead|tbody|tr|th|td|span|div|blockquote)(?:\s[^<>]*)?\/?>/g, "")).not.toContain("<");
}

const ATTACKS: [string, string][] = [
  ["script", "<p>Hello</p><script>alert(1)</script>"],
  ["SCRIPT upper case", "<p>x</p><SCRIPT>alert(1)</SCRIPT>"],
  ["script with src", "<p>x</p><script src=//evil.example/x.js></script>"],
  ["split script", "<p>x</p><scr<script>ipt>alert(1)</scr</script>ipt>"],
  ["double angle", "<p>x</p><<script>script>alert(1)<</script>/script>"],
  ["img onerror", "<p>a<img src=x onerror=alert(1)>b</p>"],
  ["img onerror upper", "<p>a<IMG SRC=x OnErRoR=alert(1)>b</p>"],
  ["svg onload", "<p>a</p><svg onload=alert(1)><circle r=1 /></svg>"],
  ["svg script", "<p>a</p><svg><script>alert(1)</script></svg>"],
  ["iframe", "<p>a</p><iframe src=\"https://evil.example\"></iframe>"],
  ["iframe srcdoc", "<p>a</p><iframe srcdoc=\"<script>alert(1)</script>\"></iframe>"],
  ["iframe javascript", "<p>a</p><iframe src=\"javascript:alert(1)\"></iframe>"],
  ["javascript link", "<p><a href=\"javascript:alert(1)\">click</a></p>"],
  ["mixed-case javascript link", "<p><a href=\"jAvAsCrIpT:alert(1)\">click</a></p>"],
  ["javascript link with tab", "<p><a href=\"java\tscript:alert(1)\">click</a></p>"],
  ["entity-encoded javascript link", "<p><a href=\"&#106;&#97;vascript&#58;alert(1)\">click</a></p>"],
  ["hex-entity javascript link", "<p><a href=\"&#x6A;avascript:alert(1)\">click</a></p>"],
  ["data link", "<p><a href=\"data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==\">x</a></p>"],
  ["vbscript link", "<p><a href=\"vbscript:msgbox(1)\">x</a></p>"],
  ["form + input", "<p>a</p><form action=\"https://evil.example\"><input name=x value=y><button>go</button></form>"],
  ["object", "<p>a</p><object data=\"javascript:alert(1)\"></object>"],
  ["embed", "<p>a</p><embed src=\"javascript:alert(1)\">"],
  ["math", "<p>a</p><math><mtext><script>alert(1)</script></mtext></math>"],
  ["style tag", "<p>a</p><style>body{background:url(javascript:alert(1))}</style>"],
  ["link tag", "<p>a</p><link rel=stylesheet href=//evil.example/x.css>"],
  ["meta refresh", "<p>a</p><meta http-equiv=refresh content=\"0;url=javascript:alert(1)\">"],
  ["base tag", "<p>a</p><base href=\"https://evil.example/\">"],
  ["comment", "<p>a</p><!-- secret <script>alert(1)</script> -->"],
  ["conditional comment", "<p>a</p><!--[if IE]><script>alert(1)</script><![endif]-->"],
  ["downlevel-revealed comment", "<p>a</p><![if !IE]><script>alert(1)</script><![endif]>"],
  ["CDATA", "<p>a</p><![CDATA[<script>alert(1)</script>]]>"],
  ["processing instruction", "<p>a</p><?xml version=\"1.0\"?><?php echo 1 ?>"],
  ["onclick on allowed tag", "<p onclick=\"alert(1)\">a</p>"],
  ["onmouseover with odd spacing", "<p\nonmouseover\n=\nalert(1)>a</p>"],
  ["handler without quotes on td", "<table><tr><td onfocus=alert(1) autofocus tabindex=1>a</td></tr></table>"],
  ["style url()", "<p style=\"background:url(javascript:alert(1))\">a</p>"],
  ["width url()", "<p style=\"width:url(x)\">a</p>"],
  ["expression()", "<p style=\"width:expression(alert(1))\">a</p>"],
  ["escaped expression()", "<p style=\"width:\\65 xpression(alert(1))\">a</p>"],
  ["CSS @import in style attribute", "<p style=\"@import 'https://evil.example/x.css'; text-align:left\">a</p>"],
  ["CSS @import in style tag", "<p>a</p><style>@import url(https://evil.example/x.css);</style>"],
  ["behavior / -moz-binding", "<p style=\"behavior:url(x.htc);-moz-binding:url(x.xml#y)\">a</p>"],
  ["broken style", "<p style=\"text-align:center;;;}{:\">a</p>"],
  ["mXSS noscript", "<noscript><p title=\"</noscript><img src=x onerror=alert(1)>\"></noscript><p>a</p>"],
  ["mXSS svg style", "<svg><style><img src=x onerror=alert(1)></style></svg><p>a</p>"],
  ["mXSS math table", "<math><mtext><table><mglyph><style><img src=x onerror=alert(1)></style></mglyph></table></mtext></math><p>a</p>"],
  ["mXSS textarea", "<p>a</p><textarea><script>alert(1)</script></textarea>"],
  ["mXSS xmp", "<p>a</p><xmp><img src=x onerror=alert(1)></xmp>"],
  ["mXSS title", "<p>a</p><title><img src=x onerror=alert(1)></title>"],
  ["mXSS template", "<p>a</p><template><img src=x onerror=alert(1)></template>"],
  ["mXSS select", "<p>a</p><select><option><img src=x onerror=alert(1)></option></select>"],
  ["mXSS plaintext", "<p>a</p><plaintext><img src=x onerror=alert(1)>"],
  ["mXSS noembed", "<p>a</p><noembed><img src=x onerror=alert(1)></noembed>"],
  ["mXSS attribute breaking", "<p title=\"&quot;><img src=x onerror=alert(1)>\">a</p>"],
  ["mXSS backtick", "<p title=`x`onclick=alert(1)>a</p>"],
  ["nested broken tags", "<p><b><i>x</p></b></i><div><table><tr><td>1"],
  ["unclosed tag at end", "<p>a</p><img src=x onerror=alert(1)"],
  ["slash between tag and attribute", "<p/onclick=alert(1)>a</p>"],
  ["null byte in tag name", "<p>a</p><scr\u0000ipt>alert(1)</scr\u0000ipt>"],
  ["null byte in handler", "<p o\u0000nclick=alert(1)>a</p>"],
  ["long s unicode tag", "<p>a</p><ſcript>alert(1)</ſcript>"],
  ["fullwidth angle brackets", "<p>＜script＞alert(1)＜/script＞</p>"],
  ["zero-width in tag", "<p>a</p><scr​ipt>alert(1)</scr​ipt>"],
  ["right-to-left override", "<p>‮gnp.exe</p>"],
  ["class / id / title / data-*", "<p class=\"x\" id=\"y\" title=\"z\" data-x=\"1\" lang=\"en\" dir=\"rtl\">a</p>"],
  ["colspan junk", "<table><tr><td colspan=\"2 onclick=alert(1)\" rowspan=\"99\">a</td></tr></table>"],
  ["colspan on p", "<p colspan=\"2\">a</p>"],
  ["srcset / background attrs", "<table background=\"javascript:alert(1)\"><tr><td>a</td></tr></table>"],
  ["deep nesting", "<div>".repeat(200) + "x" + "</div>".repeat(200)],
];

describe("attacks: the output only ever contains the safe subset", () => {
  it.each(ATTACKS)("%s", (_name, input) => {
    const r = sanitizeDocHtml(input);
    if (r.ok) assertSafe(r.html);
    else expect(["empty", "unknown_merge_field", "unsafe_text"]).toContain(r.reason);
  });
  it.each(ATTACKS)("cleaning twice gives the same result (%s)", (_name, input) => {
    const r = sanitizeDocHtml(input);
    if (!r.ok) return;
    const again = sanitizeDocHtml(r.html);
    expect(again.ok && again.html).toBe(r.html);
  });
});

describe("what is removed, and what stays", () => {
  it("allowed tags pass through unchanged", () => {
    const html = "<h1>A</h1><h2>B</h2><h3>C</h3><h4>D</h4><p><b>b</b><strong>s</strong><i>i</i><em>e</em><u>u</u><span>sp</span></p>"
      + "<ul><li>1</li></ul><ol><li>2</li></ol><blockquote>q</blockquote><div>d</div><hr /><p>x<br />y</p>"
      + "<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>c</td></tr></tbody></table>";
    expect(okHtml(html)).toBe(html);
  });
  it("script and its content are removed", () => {
    expect(okHtml("<p>Hello</p><script>alert(1)</script>")).toBe("<p>Hello</p>");
  });
  it("disallowed tags keep their text but lose the tag", () => {
    expect(okHtml("<p><a href=\"javascript:alert(1)\">click</a> <font color=red>here</font></p>")).toBe("<p>click here</p>");
  });
  it("img with onerror disappears completely", () => {
    expect(okHtml("<p>a<img src=x onerror=alert(1)>b</p>")).toBe("<p>ab</p>");
  });
  it("text is re-escaped: entity-encoded payloads stay harmless text", () => {
    expect(okHtml("<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; a < b</p>")).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; a &lt; b</p>");
  });
  it("a bare '<' in text is escaped", () => {
    expect(okHtml("<p>1 < 2 and 3 > 2</p>")).toBe("<p>1 &lt; 2 and 3 &gt; 2</p>");
  });
  it("comments are removed (incl. conditional comments)", () => {
    expect(okHtml("<p>a</p><!-- hidden --><!--[if IE]><p>ie</p><![endif]-->")).toBe("<p>a</p>");
  });
  it("only colspan / rowspan 1–20 on th / td survive", () => {
    expect(okHtml("<table><tr><td colspan=\"2\" rowspan=\"3\">a</td><th colspan=\"21\">b</th></tr></table>"))
      .toBe("<table><tr><td colspan=\"2\" rowspan=\"3\">a</td><th>b</th></tr></table>");
  });
  it("style: only the allowed properties with safe values stay", () => {
    expect(okHtml("<p style=\"text-align:center;color:red;font-weight:bold;position:fixed\">a</p>")).toBe("<p style=\"text-align:center;font-weight:bold\">a</p>");
    expect(okHtml("<p style=\"margin:0 auto;padding:4px 8px;width:50%;border:1px solid #000\">a</p>"))
      .toBe("<p style=\"margin:0 auto;padding:4px 8px;width:50%;border:1px solid #000\">a</p>");
    expect(okHtml("<p style=\"text-decoration:underline;font-style:italic\">a</p>")).toBe("<p style=\"text-decoration:underline;font-style:italic\">a</p>");
  });
  it("style: url(), expression(), escapes, negative padding, unknown units are dropped", () => {
    for (const style of ["width:url(x)", "width:expression(alert(1))", "width:\\65 xpression(1)", "padding:-5px", "width:100vw",
      "border:1px solid url(x)", "margin:1px 2px 3px 4px 5px", "text-align:center\\;", "font-weight:900px"]) {
      expect(okHtml(`<p style="${style}">a</p>`), style).toBe("<p>a</p>");
    }
  });
  it("counts what was removed", () => {
    const r = sanitizeDocHtml("<p onclick=\"x()\" class=\"y\" style=\"color:red;text-align:left\">a</p><!-- c --><script>s</script><img src=x>");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.removed).toEqual({ tags: 2, attributes: 1, handlers: 1, styles: 1, comments: 1, byTag: { script: 1, img: 1 } });
  });
  it("nothing removed → all counts 0", () => {
    const r = sanitizeDocHtml("<p>Hi {{first_name}}</p>");
    expect(r.ok && r.removed).toEqual({ tags: 0, attributes: 0, handlers: 0, styles: 0, comments: 0, byTag: {} });
  });
  it("deep nesting is cut at 40 levels instead of blowing up", () => {
    const r = sanitizeDocHtml("<div>".repeat(200) + "x" + "</div>".repeat(200));
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.html.match(/<div>/g) ?? []).length).toBeLessThanOrEqual(40);
  });
});

describe("merge fields", () => {
  it("known fields are returned (sorted, distinct)", () => {
    const r = sanitizeDocHtml("<p>Dear {{full_name}} ({{vsat_id}}), {{campus}}, {{today}}, {{first_name}} {{full_name}}</p>");
    expect(r.ok && r.mergeFields).toEqual(["campus", "first_name", "full_name", "today", "vsat_id"]);
  });
  it.each([
    "<p>{{email}}</p>", "<p>{{phone}}</p>", "<p>{{constructor}}</p>", "<p>{{__proto__}}</p>", "<p>{{ first_name }}</p>",
    "<p>{{first_name}</p>", "<p>first_name}}</p>", "<p>&#123;&#123;constructor&#125;&#125;</p>", "<p>{{first_name.constructor}}</p>",
  ])("unknown or broken field is refused: %s", (input) => {
    const r = sanitizeDocHtml(input) as Extract<SanitizeResult, { ok: false }>;
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("unknown_merge_field");
    expect(r.unknown?.length).toBeGreaterThan(0);
  });
  it("a field hidden in a removed attribute disappears with it (nothing unknown is saved)", () => {
    expect(okHtml("<p title=\"{{email}}\">Hi {{first_name}}</p>")).toBe("<p>Hi {{first_name}}</p>");
  });
});

describe("size and empty input", () => {
  it("input over 100 KB is refused before parsing", () => {
    expect(sanitizeDocHtml("<p>" + "a".repeat(102400) + "</p>")).toEqual({ ok: false, reason: "too_big" });
  });
  it("multi-byte text is counted in bytes", () => {
    expect(sanitizeDocHtml("<p>" + "é".repeat(51200) + "</p>")).toEqual({ ok: false, reason: "too_big" });
  });
  it("input just under the limit is accepted, and fast", () => {
    const html = "<p>" + "a".repeat(102400 - 7) + "</p>";
    const t = performance.now();
    const r = sanitizeDocHtml(html);
    expect(r.ok && r.bytes).toBe(102400);
    expect(performance.now() - t).toBeLessThan(1000);
  });
  it("output that grows past 100 KB after escaping is refused", () => {
    expect(sanitizeDocHtml("<p>" + "&".repeat(30000) + "</p>")).toEqual({ ok: false, reason: "too_big" });
  });
  it("100 KB of junk tags is handled in under a second", () => {
    const junk = "<x onclick=1><svg><p style='width:url(x)'>".repeat(2400).slice(0, 102000);
    const t = performance.now();
    const r = sanitizeDocHtml(junk);
    if (r.ok) assertSafe(r.html);
    expect(performance.now() - t).toBeLessThan(1000);
  });
  it.each(["", "   ", "<script>alert(1)</script>", "<!-- only a comment -->", "<img src=x onerror=alert(1)>"])("nothing left → refused as empty: %j", (input) => {
    expect(sanitizeDocHtml(input)).toEqual({ ok: false, reason: "empty" });
  });
  it.each(["<p>Learn javascript: basics</p>", "<p>JAVA SCRIPT : x</p>", "<p>&#106;avascript:x</p>", "<p>vbscript:x</p>"])("'javascript:' / 'vbscript:' as text is refused like the database does: %s", (input) => {
    expect(sanitizeDocHtml(input)).toEqual({ ok: false, reason: "unsafe_text" });
  });
  it("non-string input is refused", () => {
    expect(sanitizeDocHtml(42 as unknown as string).ok).toBe(false);
  });
});
