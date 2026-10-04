// IndexedDB の薄いラッパー（外部ライブラリは使わない）
const DB_NAME = 'pageflow';
const DB_VERSION = 1;

// ストア名 → 検索用インデックス（pdfAssets / renderImages / trashPdfs は Blob を保持する）
const STORE_DEFS = {
  booklets: null,
  contents: 'bookletId',
  pages: 'bookletId',
  pdfAssets: 'bookletId',
  renderImages: 'pdfAssetId',
  trashPdfs: 'bookletId',
};

let dbPromise = null;

export function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const [name, indexKey] of Object.entries(STORE_DEFS)) {
          const store = db.createObjectStore(name, { keyPath: 'id' });
          if (indexKey) store.createIndex(indexKey, indexKey);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

const request = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const finished = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

export async function listBookletRecords() {
  const db = await openDb();
  return request(db.transaction('booklets').objectStore('booklets').getAll());
}

export async function loadBookletRecords(bookletId) {
  const db = await openDb();
  const tx = db.transaction(['booklets', 'contents', 'pages']);
  const [booklet, contents, pages] = await Promise.all([
    request(tx.objectStore('booklets').get(bookletId)),
    request(tx.objectStore('contents').index('bookletId').getAll(bookletId)),
    request(tx.objectStore('pages').index('bookletId').getAll(bookletId)),
  ]);
  if (!booklet) return null;
  pages.sort((a, b) => a.physicalPageNumber - b.physicalPageNumber);
  return { booklet, contents, pages };
}

// PdfAsset とそれに紐づく RenderImage を削除する（tx 内で呼ぶ）
async function deleteAssetCascade(tx, assetId) {
  const images = tx.objectStore('renderImages');
  const keys = await request(images.index('pdfAssetId').getAllKeys(assetId));
  for (const key of keys) images.delete(key);
  tx.objectStore('pdfAssets').delete(assetId);
}

// 冊子・コンテンツ・ページ・PDF関連を1トランザクションで保存する（削除・ゴミ箱移動も同時に行う）
//  - putPdfAssets / putRenderImages：新規保存する PdfAsset（blob付き）／RenderImage（imageBlob付き）
//  - trashAssetIds：PdfAsset を TrashPdf へ移す（元PDFのBlobを保持。生成画像は削除）
//  - deleteAssetIds：PdfAsset と生成画像を完全に削除する
export async function saveBookletRecords({
  booklet,
  contents,
  pages,
  removedPageIds = [],
  removedContentIds = [],
  putPdfAssets = [],
  putRenderImages = [],
  trashAssetIds = [],
  deleteAssetIds = [],
}) {
  const db = await openDb();
  const tx = db.transaction(Object.keys(STORE_DEFS), 'readwrite');
  tx.objectStore('booklets').put(booklet);
  for (const c of contents) tx.objectStore('contents').put(c);
  for (const p of pages) tx.objectStore('pages').put(p);
  for (const id of removedPageIds) tx.objectStore('pages').delete(id);
  for (const id of removedContentIds) tx.objectStore('contents').delete(id);
  for (const a of putPdfAssets) tx.objectStore('pdfAssets').put(a);
  for (const i of putRenderImages) tx.objectStore('renderImages').put(i);
  for (const id of trashAssetIds) {
    const asset = await request(tx.objectStore('pdfAssets').get(id));
    if (asset) {
      tx.objectStore('trashPdfs').put({
        id: crypto.randomUUID(),
        bookletId: asset.bookletId,
        contentId: asset.contentId,
        originalFileName: asset.originalFileName,
        blob: asset.blob,
        deletedAt: new Date().toISOString(),
      });
    }
    await deleteAssetCascade(tx, id);
  }
  for (const id of deleteAssetIds) await deleteAssetCascade(tx, id);
  await finished(tx);
}

// 冊子のPDF関連レコードを読み出す。PdfAsset は元PDFのBlobを除いたメタ情報のみ返す
export async function loadPdfRecords(bookletId) {
  const db = await openDb();
  const tx = db.transaction(['pdfAssets', 'renderImages']);
  const rawAssets = await request(tx.objectStore('pdfAssets').index('bookletId').getAll(bookletId));
  const images = [];
  for (const a of rawAssets) {
    images.push(...(await request(tx.objectStore('renderImages').index('pdfAssetId').getAll(a.id))));
  }
  const assets = rawAssets.map(({ blob, ...meta }) => meta);
  return { assets, images };
}

// 冊子に紐づく全データを1トランザクションで削除する
export async function deleteBookletCascade(bookletId) {
  const db = await openDb();
  const tx = db.transaction(Object.keys(STORE_DEFS), 'readwrite');
  tx.objectStore('booklets').delete(bookletId);
  for (const name of ['contents', 'pages', 'trashPdfs']) {
    const store = tx.objectStore(name);
    const keys = await request(store.index('bookletId').getAllKeys(bookletId));
    for (const key of keys) store.delete(key);
  }
  // RenderImage は bookletId を持たないため、PdfAsset 経由で削除する
  const assets = tx.objectStore('pdfAssets');
  const assetKeys = await request(assets.index('bookletId').getAllKeys(bookletId));
  const images = tx.objectStore('renderImages');
  for (const assetId of assetKeys) {
    const imageKeys = await request(images.index('pdfAssetId').getAllKeys(assetId));
    for (const key of imageKeys) images.delete(key);
    assets.delete(assetId);
  }
  await finished(tx);
}
