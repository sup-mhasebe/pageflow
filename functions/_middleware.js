// Cloudflare Pages Functions: サイト全体の Basic 認証
// 認証情報は Cloudflare の環境変数（Secret）から取得する: BASIC_AUTH_USER / BASIC_AUTH_PASSWORD

const REALM = 'PageFlow';

const encoder = new TextEncoder();

// タイミング攻撃対策: SHA-256 で長さを揃えてから、全バイトを走査して比較する
async function safeEqual(a, b) {
  const [da, db] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  const va = new Uint8Array(da);
  const vb = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

// Authorization ヘッダーから { user, pass } を取り出す。形式不正は null
function parseBasic(header) {
  const m = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(header ?? '');
  if (!m) return null;
  let decoded;
  try {
    decoded = new TextDecoder().decode(Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
  const i = decoded.indexOf(':');
  if (i < 0) return null;
  return { user: decoded.slice(0, i), pass: decoded.slice(i + 1) };
}

const unauthorized = () =>
  new Response('認証が必要です', {
    status: 401,
    headers: {
      'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
      'Content-Type': 'text/plain; charset=UTF-8',
      'Cache-Control': 'no-store',
    },
  });

export async function onRequest({ request, env, next }) {
  const { pathname } = new URL(request.url);
  // クローラーに noindex 方針を伝えるため、robots.txt だけは認証なしで返す
  if (pathname === '/robots.txt') return next();

  // 環境変数が未設定の場合は、認証なしで公開してしまわないよう閉じる
  if (!env.BASIC_AUTH_USER || !env.BASIC_AUTH_PASSWORD) {
    return new Response('認証設定が未完了です', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=UTF-8', 'Cache-Control': 'no-store' },
    });
  }

  const cred = parseBasic(request.headers.get('Authorization'));
  if (!cred) return unauthorized();

  // 両方を必ず評価する（ユーザー名の一致有無で処理時間を変えない）
  const [okUser, okPass] = await Promise.all([
    safeEqual(cred.user, env.BASIC_AUTH_USER),
    safeEqual(cred.pass, env.BASIC_AUTH_PASSWORD),
  ]);
  if (!(okUser && okPass)) return unauthorized();

  return next();
}
