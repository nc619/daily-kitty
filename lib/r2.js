// Cloudflare R2 (S3-compatible) for photos, videos and music.
// Enabled when R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET are set.
const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_ENDPOINT } = process.env;

function makeR2() {
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) return null;
  const { AwsClient } = require('aws4fetch');
  const client = new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID.trim(), secretAccessKey: R2_SECRET_ACCESS_KEY.trim(), service: 's3', region: 'auto' });
  const endpoint = R2_ENDPOINT || `https://${R2_ACCOUNT_ID.trim()}.r2.cloudflarestorage.com`; // override only for local tests
  const base = `${endpoint}/${R2_BUCKET.trim()}`;
  const url = (key) => `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;

  async function call(method, key, body) {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await client.fetch(url(key), { method, body });
        if (res.ok || res.status === 404 || attempt >= 3) return res;
      } catch (e) {
        if (attempt >= 3) throw e;
      }
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }

  return {
    label: `R2 (${R2_BUCKET})`,
    async put(key, buf) {
      const res = await call('PUT', key, buf);
      if (!res.ok) throw new Error(`R2 put failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    },
    async get(key) {
      const res = await call('GET', key);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`R2 get failed: HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
    async exists(key) {
      const res = await call('HEAD', key);
      return res.ok;
    },
    async remove(key) {
      const res = await call('DELETE', key);
      if (!res.ok && res.status !== 404) throw new Error(`R2 delete failed: HTTP ${res.status}`);
    },
  };
}

module.exports = { r2: makeR2() };
