// 生成画像（RenderImage）の表示用 Object URL キャッシュ。
// 構成画面・面付画面（後続のビューアも）は、PDFを直接描画せず、ここから同じ生成画像を参照する。
const urls = new Map();

export const getImageUrl = (renderImageId) => (renderImageId ? (urls.get(renderImageId) ?? null) : null);

export function setImage(renderImageId, blob) {
  const old = urls.get(renderImageId);
  if (old) URL.revokeObjectURL(old);
  urls.set(renderImageId, URL.createObjectURL(blob));
}

export function removeImages(ids) {
  for (const id of ids) {
    const u = urls.get(id);
    if (u) URL.revokeObjectURL(u);
    urls.delete(id);
  }
}

export function clearImages() {
  removeImages([...urls.keys()]);
}
