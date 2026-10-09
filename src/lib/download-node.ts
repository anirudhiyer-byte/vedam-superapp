/**
 * Capture a DOM node to a PNG download.
 *
 * Uses html-to-image (SVG <foreignObject> → the browser renders it) instead of
 * html2canvas, because the certificate relies on `clip-path` (ribbons/chevrons)
 * and `background-clip:text` (gradient name + "CodeSprint") which html2canvas
 * cannot render — it was painting gradient blocks and square ribbons on download.
 * foreignObject uses the real browser engine, so the PNG matches the screen.
 */
export async function downloadNodePng(node: HTMLElement, filename: string) {
  const { toPng } = await import("html-to-image");
  // Fonts/images are same-origin (/public) or data URLs; render at 3x for print crispness.
  const dataUrl = await toPng(node, {
    pixelRatio: 3,
    cacheBust: true,
    // the certificate draws its own gradient frame, so keep the capture transparent
    backgroundColor: undefined,
    width: node.offsetWidth,
    height: node.offsetHeight,
  });
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}
