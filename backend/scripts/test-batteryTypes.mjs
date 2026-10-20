const BASE = 'http://localhost:3000';
let failed = 0;

function assert(cond, msg) {
  if (cond) console.log('✅', msg);
  else { console.error('❌', msg); failed++; }
}

async function req(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

async function main() {
  const s = Date.now();

  console.log('\n── Bootstrap ──────────────────────────────────────');
  const a = await req('POST', '/auth/register-company', {
    email: `bt-a-${s}@example.com`, name: 'Admin A', companyName: `BtCo-A ${s}`,
  });
  const b = await req('POST', '/auth/register-company', {
    email: `bt-b-${s}@example.com`, name: 'Admin B', companyName: `BtCo-B ${s}`,
  });
  const ua = await req('POST', '/auth/join-company', {
    email: `bt-ua-${s}@example.com`, name: 'User A',
    invitationCode: a.json.company.invitationCode,
  });
  assert(a.status === 201 && b.status === 201 && ua.status === 201, 'setup');
  const tA = a.json.token, tB = b.json.token, tUA = ua.json.token;

  console.log('\n── Create ─────────────────────────────────────────');
  const aa = await req('POST', '/admin/battery-types', {
    name: `AA-2000 ${s}`, lowStockThreshold: 50,
  }, tA);
  assert(aa.status === 201, 'A creates battery type → 201');
  assert(aa.json.batteryType.currentStock === 0, 'currentStock starts at 0');
  assert(aa.json.batteryType.lowStockThreshold === 50, 'threshold = 50 (integer)');
  assert(aa.json.batteryType.active === true, 'active = true by default');

  const bb = await req('POST', '/admin/battery-types', {
    name: `AA-2000 ${s}`, lowStockThreshold: 100,
  }, tB);
  assert(bb.status === 201, 'B creates same name in different company → 201');
  assert(aa.json.batteryType.id !== bb.json.batteryType.id, 'different ids across companies');
  assert(bb.json.batteryType.lowStockThreshold === 100, 'B threshold = 100');

  const noThreshold = await req('POST', '/admin/battery-types', {
    name: `AAA ${s}`,
  }, tA);
  assert(noThreshold.status === 201, 'create without threshold → 201');
  assert(noThreshold.json.batteryType.lowStockThreshold === 0, 'default threshold = 0');

  const dup = await req('POST', '/admin/battery-types', {
    name: `AA-2000 ${s}`,
  }, tA);
  assert(dup.status === 409, 'duplicate name in same company → 409');

  console.log('\n── Validation ─────────────────────────────────────');
  const fractional = await req('POST', '/admin/battery-types', {
    name: `Bad ${s}`, lowStockThreshold: 5.5,
  }, tA);
  assert(fractional.status === 400, 'fractional threshold → 400');

  const negative = await req('POST', '/admin/battery-types', {
    name: `Neg ${s}`, lowStockThreshold: -1,
  }, tA);
  assert(negative.status === 400, 'negative threshold → 400');

  const tooBig = await req('POST', '/admin/battery-types', {
    name: `Huge ${s}`, lowStockThreshold: 3000000000,
  }, tA);
  assert(tooBig.status === 400, 'threshold > 2^31-1 → 400');

  const badId = await req('GET', '/admin/battery-types/xyz', null, tA);
  assert(badId.status === 400, 'non-numeric id → 400');

  console.log('\n── Isolation ──────────────────────────────────────');
  const listA = await req('GET', '/admin/battery-types', null, tA);
  const listB = await req('GET', '/admin/battery-types', null, tB);
  const idsA = new Set(listA.json.batteryTypes.map((x) => x.id));
  const idsB = new Set(listB.json.batteryTypes.map((x) => x.id));
  assert(!idsA.has(bb.json.batteryType.id), 'A does NOT see B battery type  ← ISOLATION');
  assert(!idsB.has(aa.json.batteryType.id), 'B does NOT see A battery type  ← ISOLATION');

  const crossRead = await req('GET', `/admin/battery-types/${bb.json.batteryType.id}`, null, tA);
  assert(crossRead.status === 404, 'A reading B battery type → 404');

  const crossUpdate = await req('PATCH', `/admin/battery-types/${bb.json.batteryType.id}`,
    { name: 'Hijacked' }, tA);
  assert(crossUpdate.status === 404, 'A updating B battery type → 404');

  const bAfter = await req('GET', `/admin/battery-types/${bb.json.batteryType.id}`, null, tB);
  assert(bAfter.json.batteryType.name === `AA-2000 ${s}`, 'B untouched after A attempts');

  console.log('\n── Update own battery type ────────────────────────');
  const upd = await req('PATCH', `/admin/battery-types/${aa.json.batteryType.id}`, {
    name: `AA-2000v2 ${s}`, lowStockThreshold: 75,
  }, tA);
  assert(upd.status === 200, 'update own → 200');
  assert(upd.json.batteryType.name === `AA-2000v2 ${s}`, 'name updated');
  assert(upd.json.batteryType.lowStockThreshold === 75, 'threshold updated');

  console.log('\n── Deactivate / reactivate ────────────────────────');
  const deact = await req('PATCH', `/admin/battery-types/${aa.json.batteryType.id}`, { active: false }, tA);
  assert(deact.json.batteryType.active === false, 'deactivate works');
  const activeOnly = await req('GET', '/admin/battery-types?active=true', null, tA);
  assert(!activeOnly.json.batteryTypes.find((x) => x.id === aa.json.batteryType.id),
    'deactivated excluded from ?active=true');
  const react = await req('PATCH', `/admin/battery-types/${aa.json.batteryType.id}`, { active: true }, tA);
  assert(react.json.batteryType.active === true, 'reactivate works');

  console.log('\n── Role enforcement ───────────────────────────────');
  const userList = await req('GET', '/admin/battery-types', null, tUA);
  assert(userList.status === 403, 'regular user lists → 403');
  const userCreate = await req('POST', '/admin/battery-types', { name: 'Nope' }, tUA);
  assert(userCreate.status === 403, 'regular user creates → 403');

  console.log('');
  if (failed) { console.error(`❌ ${failed} check(s) failed`); process.exit(1); }
  console.log('🎉 ALL BATTERY TYPE CRUD + ISOLATION CHECKS PASSED');
}

main().catch((e) => { console.error('test crashed:', e); process.exit(1); });
