"use client";
/** CodeSprint stats band + module section. Matches the finalised v4 mock:
 *  PLAIN orange band (no bottom-curve SVG) + black section below with NO
 *  inverted z-index — natural stacking so the first card overlaps UP onto the
 *  orange (its clip-path curved top is the only curve). */
export function CsBand({ children }: { children?: React.ReactNode }) {
  return (
    <div className="bg-[#141414]">
      {/* ORANGE band — plain rectangle, content inside */}
      <section className="bg-[linear-gradient(180deg,#FF9E12_0%,#FD7B03_60%,#F97101_100%)] px-6 pb-[140px] pt-[96px] text-center sm:px-10 lg:px-[146px]">
        <h2 className="font-[family-name:var(--font-inter)] font-medium text-white" style={{ fontSize: "clamp(20px,2.1vw,30px)", letterSpacing: "-0.7px" }}>
          Built for coders who want to <span className="font-[family-name:var(--font-playfair)] font-semibold italic">start early</span>
        </h2>
        <div className="mx-auto mt-7 flex max-w-[1200px] items-stretch justify-center">
          {[["Courses offered", "4 Industry Led Modules"], ["Duration", "Less than 4 hours each"], ["Taught by", "MAANG Experts"]].map(([lbl, val], i) => (
            <div key={lbl} className="flex flex-1 items-stretch">
              {i > 0 && <span className="my-1.5 w-px bg-white/45" />}
              <div className="flex-1 px-6 text-center">
                <div className="text-white" style={{ fontSize: "clamp(12px,1.3vw,17px)" }}>{lbl}</div>
                <div className="mt-1.5 font-semibold text-[#231a10]" style={{ fontSize: "clamp(13px,1.5vw,20px)", letterSpacing: "-0.4px" }}>{val}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* BLACK section — module cards; first straddles via -mt (natural stacking = on top of orange) */}
      <section className="bg-[#141414] px-6 pb-16 sm:px-10 lg:px-[90px]">
        {children}
      </section>
    </div>
  );
}

/** the ⌣ curve at the BOTTOM of the HERO (orange behind). Kept — hero→orange transition only. */
export function HeroCurve() {
  return <svg aria-hidden className="pointer-events-none absolute bottom-[-129px] left-0 z-[3] block h-[130px] w-full" viewBox="0 0 1440 130" preserveAspectRatio="none"><path d="M0,0 L1440,0 L1440,10 Q720,140 0,10 Z" fill="#0d0d0d" /></svg>;
}
