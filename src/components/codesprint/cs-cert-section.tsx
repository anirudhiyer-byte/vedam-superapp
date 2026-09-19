"use client";
import VedamCertificate from "@/components/events/vedam-certificate";
const CERT_QR = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAATYAAAE2AQAAAADDx4MEAAACQUlEQVR4nO2aQY7cIBBFXwVLs8RSDjBHoW+QM+Vm9lH6AC3hZSSsnwVgO8ksRoqG7nbjBbLNk0z5iyqqwMRnrvXbpzDo3P9xaNruJIkgCXCSlGqXT49ux4k4r/Lv53E1WMyyRvNYNNL0FHacghuAdQB/y89iccmCVgMPzBfQHcf3atxwfFjexPwjodmc7Eu/27mPr6MeQaspRDD8zQjT+nXf7dzH1wA4ASv1DggTYh5vEHTf8b0gt5iZ2VDi+Tyupp/jmt2VmZnZ5SnsOAU3bDMAwMlCXDG8k+Hd1tXzj2bcPAKwWm2cNC0D0tXy8tcuz2DHOTikWFNBAE04afISITqBTxDU88FGXJXCJzT5lOXZO+rV9WjE1d8eXZ4QUqylkqBEedf1aMnV0DG/l4KV2biFcp9gHp/CjjNwaPJSiRocClZUH5a92aPbcRaO4qqUyHNhKy8WKYDur9pxJYCH6FTi+VZ0DxG2QP/odpyFI8+F3MTdX7ksSn3X9WjE5f2oLEB2VbFoVN1Xbh7djjNxTuB/mXQdMHuX7LJXFq9vfT+qIcchF88BY9+q9apOq/urVlzJyksoP2aBpb/7q6bcsSwy1YCRk/Q9Menzoxn39/mSrMIWz2uO2PVox+0CLJYrJ2aj077muvP4Xor743yJT4OF64BYDMAAhnTP8b00t7yVDQ+glnbj2vejGnLDP2+W7zJwyeaR/czPo9txFo49gNcq4iGKQ4j0+lVD7ri+mnwRoNQTc5P6+qohZ/18+0NxvwHK3s2Hr7sn9AAAAABJRU5ErkJggg==";

const BTN_CSS = `
.cs-freebtn{position:relative;height:52px;display:inline-flex;align-items:center;padding:0 30px;border-radius:14px;
  background:linear-gradient(180deg,rgba(24,16,7,.62),rgba(6,4,2,.72));backdrop-filter:blur(9px);-webkit-backdrop-filter:blur(9px);
  box-shadow:inset 0 1px 0 rgba(255,200,140,.22), inset 0 0 18px rgba(253,120,3,.10);overflow:hidden;transition:box-shadow .28s,background .28s}
.cs-freebtn::before{content:"";position:absolute;inset:0;border-radius:14px;padding:1px;background:linear-gradient(120deg,rgba(255,180,31,1),rgba(253,83,0,.7) 50%,rgba(255,160,70,.85));
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none}
.cs-freebtn:hover{background:linear-gradient(180deg,rgba(253,120,3,.32),rgba(253,83,0,.20));box-shadow:inset 0 1px 0 rgba(255,220,170,.4), inset 0 0 26px rgba(253,120,3,.35)}`;

/** Certificate section — heading + "Start Learning for FREE" (left), completion certificate preview (right). */
export function CsCertSection({ onStartLearning }: { onStartLearning?: () => void }) {
  return (
    <section className="relative overflow-hidden bg-[#0d0d0d] px-6 py-20 sm:px-10 lg:px-[146px]">
      <style dangerouslySetInnerHTML={{ __html: BTN_CSS }} />
      {/* polka texture */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/cs-polka.webp" alt="" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-[0.18]" />
      {/* orange glow bleeding down from the module band above */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-48" style={{ background: "radial-gradient(120% 100% at 50% 0%,rgba(253,120,3,0.28),transparent 70%)" }} />

      <div className="relative z-10 grid items-center gap-12 lg:grid-cols-2">
        {/* LEFT — heading + button */}
        <div className="text-center lg:text-left">
          <h2 className="font-[family-name:var(--font-inter)] font-semibold leading-[1.15] text-white" style={{ fontSize: "clamp(21px,2.3vw,34px)", letterSpacing: "-1.1px" }}>
            Get a <span className="font-[family-name:var(--font-playfair)] italic">Certificate</span><br />of Completion at the end
          </h2>
          <button onClick={onStartLearning} className="cs-freebtn mt-8">
            <span className="font-[family-name:var(--font-inter)] text-[18px] font-bold" style={{ backgroundImage: "linear-gradient(92deg,#FD5300,#FFB41F 74%)", WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent", color: "transparent" }}>Start Learning for FREE</span>
          </button>
        </div>

        {/* RIGHT — completion certificate preview (the component we built) */}
        <div className="flex justify-center lg:justify-end">
          <div className="w-full max-w-[720px]" style={{ containerType: "inline-size" }}>
            <div style={{ width: "100%", aspectRatio: "1123 / 793", overflow: "hidden" }}>
              <div style={{ width: 1123, height: 793, transformOrigin: "top left", transform: "scale(calc(100cqw / 1123px))" }}>
                <VedamCertificate kind="completion" fullName="Your Name" bootcampName="Name of Course" qrCaption="Scan to verify" qrDataUrl={CERT_QR} showQr />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
