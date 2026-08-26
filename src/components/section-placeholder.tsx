export function SectionPlaceholder({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-24">
      <span className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-accent">
        {eyebrow}
      </span>
      <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-heading sm:text-4xl">
        {title}
      </h1>
      <p className="mt-4 font-body text-base leading-relaxed text-muted">{body}</p>
    </div>
  );
}
