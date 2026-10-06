// 統合テスト用の PDF fixture を生成するスクリプト（外部ライブラリなし。Node 標準のみ）。
//   使い方: node tests/fixtures/make-fixtures.mjs
// すべて合成データ（単色・グラデーションの図形のみ）。実在の資料・個人情報・顧客データは一切含まない。
// Canva 等の実用PDFを想定し、「画像（ICC/CMYK/パレット）」「透明（ソフトマスク・不透明度）」「シェーディング」
// を含めている。1ファイルあたり数KBの小さなファイル。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pdf');
fs.mkdirSync(OUT, { recursive: true });

export const A4 = [595.28, 841.89];
export const A3L = [1190.55, 841.89];
export const A4L = [841.89, 595.28];

const latin1 = (s) => Buffer.from(s, 'latin1');
const md5 = (...bufs) => crypto.createHash('md5').update(Buffer.concat(bufs)).digest();

// ---- RC4（パスワード保護PDFの暗号化用。OpenSSL 3 では RC4 が使えないため自前で実装）----
function rc4(key, data) {
  const s = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(data.length);
  let a = 0;
  let b = 0;
  for (let k = 0; k < data.length; k++) {
    a = (a + 1) & 255;
    b = (b + s[a]) & 255;
    [s[a], s[b]] = [s[b], s[a]];
    out[k] = data[k] ^ s[(s[a] + s[b]) & 255];
  }
  return out;
}

const PAD = Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex');
const padPassword = (pw) => Buffer.concat([Buffer.from(pw, 'latin1'), PAD]).subarray(0, 32);

// 標準セキュリティハンドラ V=2 R=3（RC4 128bit）。ユーザーパスワードが必要なPDFを作る
function makeEncryption(userPw, ownerPw, docId) {
  const keyLen = 16;
  const P = -4; // 権限（全許可に近い値）
  // Algorithm 3: O
  let h = md5(padPassword(ownerPw));
  for (let i = 0; i < 50; i++) h = md5(h);
  const ownerKey = h.subarray(0, keyLen);
  let O = rc4(ownerKey, padPassword(userPw));
  for (let i = 1; i <= 19; i++) O = rc4(Buffer.from(ownerKey.map((b) => b ^ i)), O);
  // Algorithm 2: 暗号化キー
  const pBuf = Buffer.alloc(4);
  pBuf.writeInt32LE(P);
  let k = md5(padPassword(userPw), O, pBuf, docId);
  for (let i = 0; i < 50; i++) k = md5(k.subarray(0, keyLen));
  const key = k.subarray(0, keyLen);
  // Algorithm 5: U
  let U = rc4(key, md5(PAD, docId));
  for (let i = 1; i <= 19; i++) U = rc4(Buffer.from(key.map((b) => b ^ i)), U);
  U = Buffer.concat([U, Buffer.alloc(16)]);
  const objKey = (num) => {
    const n = Buffer.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, 0, 0]);
    return md5(key, n).subarray(0, Math.min(keyLen + 5, 16));
  };
  return { O, U, P, key, encryptStream: (num, data) => rc4(objKey(num), data) };
}

// ---- PDF ライター ----
class PdfWriter {
  constructor() {
    this.objs = []; // { dict, stream }
  }
  // 予約（番号だけ先に確保）
  reserve() {
    this.objs.push(null);
    return this.objs.length;
  }
  set(num, dict, stream = null) {
    this.objs[num - 1] = { dict, stream };
    return num;
  }
  add(dict, stream = null) {
    return this.set(this.reserve(), dict, stream);
  }
  // ストリーム（既定でFlate圧縮）
  addStream(dictBody, data, { compress = true } = {}) {
    const raw = Buffer.isBuffer(data) ? data : latin1(data);
    const body = compress ? zlib.deflateSync(raw) : raw;
    return this.add(`${dictBody}${compress ? ' /Filter /FlateDecode' : ''}`, body);
  }
  build(rootNum, { encryption = null, encryptNum = null, docId }) {
    const chunks = [Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])]; // %PDF-1.5 + バイナリ印
    let pos = chunks[0].length;
    const offsets = [];
    this.objs.forEach((o, i) => {
      const num = i + 1;
      offsets.push(pos);
      let body = o.stream;
      if (body && encryption && num !== encryptNum) body = encryption.encryptStream(num, body);
      const head = latin1(`${num} 0 obj\n<< ${o.dict}${body ? ` /Length ${body.length}` : ''} >>\n`);
      const parts = body ? [head, latin1('stream\n'), body, latin1('\nendstream\nendobj\n')] : [head, latin1('endobj\n')];
      for (const p of parts) {
        chunks.push(p);
        pos += p.length;
      }
    });
    const xrefPos = pos;
    let xref = `xref\n0 ${this.objs.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
    const idHex = docId.toString('hex');
    xref += `trailer\n<< /Size ${this.objs.length + 1} /Root ${rootNum} 0 R /ID [<${idHex}> <${idHex}>]${encryptNum ? ` /Encrypt ${encryptNum} 0 R` : ''} >>\nstartxref\n${xrefPos}\n%%EOF\n`;
    chunks.push(latin1(xref));
    return Buffer.concat(chunks);
  }
}

// 最小のICCプロファイル（sRGB相当の行列/TRC方式）。ICCBased色空間の経路を通すためのもの
function makeIccProfile() {
  const s15 = (v) => {
    const b = Buffer.alloc(4);
    b.writeInt32BE(Math.round(v * 65536));
    return b;
  };
  const xyzTag = (x, y, z) => Buffer.concat([latin1('XYZ '), Buffer.alloc(4), s15(x), s15(y), s15(z)]);
  const curvTag = Buffer.concat([latin1('curv'), Buffer.alloc(4), Buffer.from([0, 0, 0, 1]), Buffer.from([0x02, 0x33]), Buffer.alloc(2)]); // gamma 2.2
  const text = (s) => Buffer.concat([latin1('text'), Buffer.alloc(4), latin1(`${s}\0`)]);
  const desc = (s) => {
    const ascii = latin1(`${s}\0`);
    const b = Buffer.alloc(12 + ascii.length + 4 + 4 + 2 + 1 + 67);
    b.write('desc', 0, 'latin1');
    b.writeUInt32BE(ascii.length, 8);
    ascii.copy(b, 12);
    return b;
  };
  const tags = [
    ['desc', desc('PageFlow test sRGB-like')],
    ['cprt', text('Public domain (test fixture)')],
    ['wtpt', xyzTag(0.9505, 1.0, 1.089)],
    ['rXYZ', xyzTag(0.4360, 0.2225, 0.0139)],
    ['gXYZ', xyzTag(0.3851, 0.7169, 0.0971)],
    ['bXYZ', xyzTag(0.1431, 0.0606, 0.7141)],
    ['rTRC', curvTag],
    ['gTRC', curvTag],
    ['bTRC', curvTag],
  ];
  const tableSize = 4 + tags.length * 12;
  let offset = 128 + tableSize;
  const table = [Buffer.from([0, 0, 0, tags.length])];
  const bodies = [];
  for (const [sig, data] of tags) {
    const padded = Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4)]);
    const e = Buffer.alloc(12);
    e.write(sig, 0, 'latin1');
    e.writeUInt32BE(offset, 4);
    e.writeUInt32BE(data.length, 8);
    table.push(e);
    bodies.push(padded);
    offset += padded.length;
  }
  const header = Buffer.alloc(128);
  header.writeUInt32BE(offset, 0); // プロファイルサイズ
  header.write('none', 4, 'latin1');
  header.writeUInt32BE(0x02100000, 8); // v2.1
  header.write('mntr', 12, 'latin1');
  header.write('RGB ', 16, 'latin1');
  header.write('XYZ ', 20, 'latin1');
  header.writeUInt16BE(2026, 24);
  header.writeUInt16BE(1, 26);
  header.writeUInt16BE(1, 28);
  header.write('acsp', 36, 'latin1');
  header.writeInt32BE(Math.round(0.9642 * 65536), 68); // D50
  header.writeInt32BE(65536, 72);
  header.writeInt32BE(Math.round(0.8249 * 65536), 76);
  return Buffer.concat([header, ...table, ...bodies]);
}

// ---- ページの内容 ----
// 各ページ：背景グレー、シェーディング、ICC画像、ソフトマスク付き画像、CMYK画像、パレット画像、半透明の図形
function addPageResources(pdf) {
  const icc = pdf.addStream('/N 3 /Alternate /DeviceRGB', makeIccProfile());
  const solid = (w, h, rgb) => Buffer.from(Array.from({ length: w * h }, () => rgb).flat());
  const imgIcc = pdf.addStream(`/Type /XObject /Subtype /Image /Width 8 /Height 8 /BitsPerComponent 8 /ColorSpace [/ICCBased ${icc} 0 R]`, solid(8, 8, [200, 30, 30]));
  // ソフトマスク：左から右へ 0 → 255 のグラデーション（透明 → 不透明）
  const smaskData = Buffer.from(Array.from({ length: 8 * 8 }, (_, i) => Math.round(((i % 8) / 7) * 255)));
  const smask = pdf.addStream('/Type /XObject /Subtype /Image /Width 8 /Height 8 /BitsPerComponent 8 /ColorSpace /DeviceGray', smaskData);
  const imgMask = pdf.addStream(`/Type /XObject /Subtype /Image /Width 8 /Height 8 /BitsPerComponent 8 /ColorSpace /DeviceRGB /SMask ${smask} 0 R`, solid(8, 8, [0, 0, 255]));
  const imgCmyk = pdf.addStream('/Type /XObject /Subtype /Image /Width 4 /Height 4 /BitsPerComponent 8 /ColorSpace /DeviceCMYK', solid(4, 4, [255, 0, 0, 0])); // シアン
  const imgIdx = pdf.addStream('/Type /XObject /Subtype /Image /Width 4 /Height 4 /BitsPerComponent 8 /ColorSpace [/Indexed /DeviceRGB 1 <00AA00 FFFF00>]', Buffer.alloc(16, 0)); // 緑
  const fn = pdf.add('/FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [1 1 0] /N 1'); // 赤 → 黄
  const sh = pdf.add(`/ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 1 0] /Function ${fn} 0 R /Extend [true true]`);
  return `/XObject << /ImgIcc ${imgIcc} 0 R /ImgMask ${imgMask} 0 R /ImgCmyk ${imgCmyk} 0 R /ImgIdx ${imgIdx} 0 R >> /ExtGState << /GS1 << /ca 0.5 /CA 0.5 >> >> /Shading << /Sh1 ${sh} 0 R >>`;
}

// A4ページ（595.28×841.89）に、各要素を決まった位置に置く（テストはこの位置の色を検証する）
const A4_CONTENT = [
  '0.9 g 0 0 595.28 841.89 re f', // 背景グレー（透明の確認用）
  'q 50 760 495 60 re W n 495 0 0 60 50 760 cm /Sh1 sh Q', // シェーディング（赤→黄）
  'q 200 0 0 120 50 600 cm /ImgIcc Do Q', // ICC画像（赤 200,30,30）
  '1 1 0 rg 300 600 200 120 re f q 200 0 0 120 300 600 cm /ImgMask Do Q', // 黄の上にソフトマスク付きの青（左=透明→右=不透明）
  'q 200 0 0 120 50 440 cm /ImgCmyk Do Q', // CMYK画像（シアン）
  'q 200 0 0 120 300 440 cm /ImgIdx Do Q', // パレット画像（緑）
  'q /GS1 gs 0 1 0 rg 50 280 200 120 re f Q', // 半透明の緑（グレーの背景に重なる）
].join('\n');

function singlePagePdf({ size, content, rich = true, encryption = null, docId }) {
  const pdf = new PdfWriter();
  const catalog = pdf.reserve();
  const pages = pdf.reserve();
  const res = rich ? addPageResources(pdf) : '';
  const contentNum = pdf.addStream('', content);
  const page = pdf.add(`/Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${size[0]} ${size[1]}] /Resources << ${res} >> /Contents ${contentNum} 0 R`);
  pdf.set(pages, `/Type /Pages /Kids [${page} 0 R] /Count 1`);
  pdf.set(catalog, `/Type /Catalog /Pages ${pages} 0 R`);
  let encryptNum = null;
  if (encryption) {
    encryptNum = pdf.add(`/Filter /Standard /V 2 /R 3 /Length 128 /P ${encryption.P} /O <${encryption.O.toString('hex')}> /U <${encryption.U.toString('hex')}>`);
  }
  return pdf.build(catalog, { encryption, encryptNum, docId });
}

// 複数ページ：pages = [{ size, content }]（リソースは共通）
function multiPagePdf(pages, docId) {
  const pdf = new PdfWriter();
  const catalog = pdf.reserve();
  const pagesNum = pdf.reserve();
  const res = addPageResources(pdf);
  const kids = pages.map((p) => {
    const contentNum = pdf.addStream('', p.content);
    return pdf.add(`/Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 ${p.size[0]} ${p.size[1]}] /Resources << ${res} >> /Contents ${contentNum} 0 R`);
  });
  pdf.set(pagesNum, `/Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length}`);
  pdf.set(catalog, `/Type /Catalog /Pages ${pagesNum} 0 R`);
  return pdf.build(catalog, { docId });
}

const solidPage = (size, rgb) => ({ size, content: `${rgb.join(' ')} rg 0 0 ${size[0]} ${size[1]} re f` });
// A3横：左半分=赤、右半分=青。各半分に、画像・透明を含む要素を置く
const A3_CONTENT = [
  '1 0 0 rg 0 0 595.275 841.89 re f',
  '0 0 1 rg 595.275 0 595.275 841.89 re f',
  'q 200 0 0 120 200 600 cm /ImgIcc Do Q', // 左半分の画像
  'q /GS1 gs 1 1 1 rg 100 300 300 200 re f Q', // 左半分の半透明の白
  'q 200 0 0 120 800 600 cm /ImgCmyk Do Q', // 右半分の画像
  'q /GS1 gs 1 1 1 rg 700 300 300 200 re f Q', // 右半分の半透明の白
].join('\n');

// 固定のID（再生成しても同じバイト列になるように）
const docId = md5(latin1('pageflow-test-fixture'));

const files = {
  'image-transparency.pdf': singlePagePdf({ size: A4, content: A4_CONTENT, docId }),
  'a3-landscape.pdf': singlePagePdf({ size: A3L, content: A3_CONTENT, docId }),
  'multi-a4.pdf': multiPagePdf([solidPage(A4, [1, 0, 0]), solidPage(A4, [0, 0.8, 0]), solidPage(A4, [0, 0, 1])], docId),
  'mixed-a4-a3.pdf': multiPagePdf([solidPage(A4, [1, 0, 0]), { size: A3L, content: A3_CONTENT }], docId),
  'a4-landscape.pdf': singlePagePdf({ size: A4L, content: '0.5 g 0 0 841.89 595.28 re f', rich: false, docId }),
};
// パスワード保護（ユーザーパスワード: "secret"。空のパスワードでは開けない）
const enc = makeEncryption('secret', 'owner-secret', docId);
files['password-protected.pdf'] = singlePagePdf({ size: A4, content: A4_CONTENT, encryption: enc, docId });
// 壊れたファイル
files['not-a-pdf.pdf'] = Buffer.from('これはPDFではありません。PageFlowのテスト用の文字列です。');
files['garbage.pdf'] = Buffer.concat([latin1('%PDF-1.5\n'), crypto.createHash('sha256').update('garbage').digest(), Buffer.alloc(300, 0x7f)]);
files['truncated.pdf'] = files['image-transparency.pdf'].subarray(0, Math.floor(files['image-transparency.pdf'].length * 0.45));

for (const [name, data] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT, name), data);
  console.log(`${name.padEnd(26)} ${String(data.length).padStart(6)} bytes`);
}
