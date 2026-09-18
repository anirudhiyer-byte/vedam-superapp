"use client";
/** CodeSprint stats band — two-shape curved structure (from approved v3 mock).
 *  ORANGE rounded shape (back) with tagline+stats + a ⌣ top curve (hero dips in);
 *  BLACK rounded shape (front) overlaps up, its curved top forms the band's curved
 *  lower edge; module cards sit on the black (first card straddles via its own -mt). */
export function CsBand({ children }: { children?: React.ReactNode }) {
  return (
    <div className="bg-[#0d0d0d]">
      <div className="relative pb-10">
        {/* ORANGE rounded shape (back) */}
        <section className="relative text-center" style={{ background: "linear-gradient(180deg,#FF9E12,#FD7B03 60%,#F97101)", borderRadius: "60px 60px 40px 40px/48px 48px 40px 40px", padding: "82px clamp(24px,5vw,120px) 185px" }}>
          {/* ⌣ top curve — black hero dipping into the orange top */}
          <svg aria-hidden className="absolute left-0 top-[-1px] block h-[90px] w-full" style={{ zIndex: 1 }} viewBox="0 0 1440 90" preserveAspectRatio="none"><path d="M0,0 L1440,0 L1440,8 Q720,100 0,8 Z" fill="#0d0d0d" /></svg>
          <h2 className="relative z-[2] font-[family-name:var(--font-inter)] font-medium text-white" style={{ fontSize: "clamp(20px,2.1vw,30px)", letterSpacing: "-0.7px" }}>
            Built for coders who want to <span className="font-[family-name:var(--font-playfair)] font-semibold italic">start early</span>
          </h2>
          <div className="relative z-[2] mx-auto mt-2 flex max-w-[1100px] items-stretch justify-center">
            {[["Courses offered", "4 Industry Led Modules"], ["Duration", "Less than 4 hours each"], ["Taught by", "MAANG Experts"]].map(([lbl, val], i) => (
              <div key={lbl} className="flex flex-1 items-stretch">
                {i > 0 && <span className="my-1 w-px bg-white/45" />}
                <div className="flex-1 px-6 text-center">
                  <div className="text-white" style={{ fontSize: "clamp(12px,1.3vw,17px)" }}>{lbl}</div>
                  <div className="mt-1.5 font-semibold text-[#231a10]" style={{ fontSize: "clamp(13px,1.5vw,20px)", letterSpacing: "-0.4px" }}>{val}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* BLACK rounded shape (front) — overlaps up, holds the module cards */}
        <section className="relative z-[2]" style={{ marginTop: "-130px", background: "#141414", borderRadius: "52px 52px 60px 60px/46px 46px 56px 56px", padding: "0 clamp(20px,4vw,70px) 46px" }}>
          <div className="relative pt-10">{children}</div>
        </section>

        {/* thick curved ORANGE band ending — peeks below the black band's curved bottom */}
        <section aria-hidden className="relative" style={{ zIndex: 1, marginTop: "-96px", background: "linear-gradient(180deg,#FD7B03 0%,#F97101 100%)", borderRadius: "40px 40px 46px 46px/40px 40px 42px 42px", height: "175px" }} />
      </div>
    </div>
  );
}
