// IndexedDB の薄いラッパー（外部ライブラリは使わない）
const DB_NAME = 'pageflow';
const DB_VERSION = 1;

// ストア名 → 検索用インデックス。Blobを扱うストアはPhase 4以降で使用する
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

// 冊子・コンテンツ・ページを1トランザクションで保存する（削除対象があれば同時に削除）
export async function saveBookletRecords({
  booklet,
  contents,
  pages,
  removedPageIds = [],
  removedContentIds = [],
}) {
  const db = await openDb();
  const tx = db.transaction(['booklets', 'contents', 'pages'], 'readwrite');
  tx.objectStore('booklets').put(booklet);
  for (const c of contents) tx.objectStore('contents').put(c);
  for (const p of pages) tx.objectStore('pages').put(p);
  for (const id of removedPageIds) tx.objectStore('pages').delete(id);
  for (const id of removedContentIds) tx.objectStore('contents').delete(id);
  await finished(tx);
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
