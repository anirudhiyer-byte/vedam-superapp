"use client";

import katex from "katex";
import "katex/dist/katex.min.css";

/* Renders PYQ question text. Segments wrapped in $...$ (inline) or $$...$$
   (display) are typeset with KaTeX; everything else is plain text. Plain
   segments are React text nodes, so question text is never injected as HTML.
   Invalid TeX falls back to the raw source (throwOnError: false). */

const MATH = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;

function render(tex: string, display: boolean): string {
  return katex.renderToString(tex, { displayMode: display, throwOnError: false, output: "html", strict: "ignore" });
}

/* A line holding only "OR" (marking-scheme alternative answers). */
const OR_LINE = /\n[ \t]*or[ \t]*(?=\n|$)/gi;

/* Answer text: each alternative answer on its own, with a centred "OR" between them. */
export function SolutionText({ text }: { text: string }) {
  const parts = ("\n" + text).split(OR_LINE).map((t) => t.replace(/^\s*\n/, "").replace(/\n\s*$/, "")).filter((t) => t.trim() !== "");
  if (parts.length < 2) return <MathText text={text} />;
  return (
    <>
      {parts.map((t, i) => (
        <span key={i} style={{ display: "block" }}>
          {i > 0 && <span className="pyq-or">OR</span>}
          <MathText text={t} />
        </span>
      ))}
    </>
  );
}

export function MathText({ text, className }: { text: string; className?: string }) {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  MATH.lastIndex = 0;
  while ((m = MATH.exec(text)) !== null) {
    if (m.index > last) nodes.push(<span key={key++}>{text.slice(last, m.index)}</span>);
    const display = m[1] !== undefined;
    const tex = display ? m[1] : m[2];
    nodes.push(
      <span key={key++} className={display ? "pyq-math-display" : undefined}
        dangerouslySetInnerHTML={{ __html: render(tex, display) }} />
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(<span key={key++}>{text.slice(last)}</span>);
  return <span className={className} style={{ whiteSpace: "pre-wrap" }}>{nodes}</span>;
}
