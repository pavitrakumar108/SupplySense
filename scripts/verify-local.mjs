const base = process.env.LOCAL_API_URL ?? 'http://127.0.0.1:4000/api/v1';

async function checkUrl(url, expectedStatus = 200) {
  const response = await fetch(url);
  const body = await response.json().catch(() => ({}));
  if (response.status !== expectedStatus) throw new Error(`${url}: expected ${expectedStatus}, received ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

const check = (path, expectedStatus = 200) => checkUrl(`${base}${path}`, expectedStatus);
const live = await check('/health/live');
const ready = await check('/health/ready');
const identity = await checkUrl(`${new URL(base).origin}/`);
console.log(JSON.stringify({ api: base, live: live.data, ready: ready.data, identity: identity.data }, null, 2));
