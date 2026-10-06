import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/_middleware.js';

// 合成のダミー値（実際の認証情報ではない）
const env = { BASIC_AUTH_USER: 'dummy-user', BASIC_AUTH_PASSWORD: 'dummy-pass:with-colon' };
const basic = (u, p) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');

const call = (path, auth, e = env) => {
  const headers = auth ? { Authorization: auth } : {};
  return onRequest({
    request: new Request('https://example.test' + path, { headers }),
    env: e,
    next: async () => new Response('APP', { status: 200 }),
  });
};

test('Basic認証：未認証・誤り・不正形式は401＋WWW-Authenticate、正しい資格情報のみ通過', async () => {
  for (const auth of [undefined, basic('dummy-user', 'wrong'), basic('wrong', env.BASIC_AUTH_PASSWORD), 'Basic !!!', 'Bearer x']) {
    const r = await call('/', auth);
    assert.equal(r.status, 401);
    assert.match(r.headers.get('WWW-Authenticate'), /^Basic realm=/);
  }
  const ok = await call('/', basic(env.BASIC_AUTH_USER, env.BASIC_AUTH_PASSWORD));
  assert.equal(ok.status, 200);
});

test('Basic認証：robots.txt は認証なしで通過／環境変数未設定は503で閉じる', async () => {
  assert.equal((await call('/robots.txt')).status, 200);
  assert.equal((await call('/', basic('a', 'b'), {})).status, 503);
});
