/** Capture a DOM node to a PNG download via html2canvas (client only). */
export async function downloadNodePng(node: HTMLElement, filename: string) {
  const html2canvas = (await import("html2canvas")).default;
  const canvas = await html2canvas(node, { scale: 3, useCORS: true, backgroundColor: null });
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = filename;
  a.click();
}
