"use client";
/** CodeSprint stats band + module section frame. Downward-C (⌣) curves: hero
 *  bottom dips into orange, orange dips into black. Tagline+stats inside the
 *  orange (upper), clear of the hero curve. Module cards are passed as children. */
export function CsBand({ children }: { children?: React.ReactNode }) {
  return (
    <div className="relative bg-[#141414]">
      {/* ORANGE band — content inside, own ⌣ bottom */}
      <section className="relative z-[2] bg-[linear-gradient(180deg,#FF9E12_0%,#FD7B03_60%,#F97101_100%)] px-6 pb-[150px] pt-[96px] sm:px-10 lg:px-[146px]">
        <div className="relative z-[3] text-center">
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
        </div>
        {/* orange's ⌣ bottom (black behind) */}
        <svg className="absolute bottom-[-1px] left-0 z-[2] block h-[140px] w-full" viewBox="0 0 1440 140" preserveAspectRatio="none"><path d="M0,140 L0,20 Q720,150 1440,20 L1440,140 Z" fill="#141414" /></svg>
      </section>

      {/* BLACK section — module cards; first straddles the seam via negative margin */}
      <section className="relative z-[4] bg-[#141414] px-6 pb-16 sm:px-10 lg:px-[90px]">
        <div className="relative z-[5]">{children}</div>
      </section>
    </div>
  );
}

/** the ⌣ curve to place at the BOTTOM of the hero (orange behind). Render inside the hero, absolutely, bottom:-129px. */
export function HeroCurve() {
  return <svg aria-hidden className="pointer-events-none absolute bottom-[-129px] left-0 z-[3] block h-[130px] w-full" viewBox="0 0 1440 130" preserveAspectRatio="none"><path d="M0,0 L1440,0 L1440,10 Q720,140 0,10 Z" fill="#0d0d0d" /></svg>;
}
