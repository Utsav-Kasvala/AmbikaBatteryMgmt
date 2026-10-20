import { withLoginCode } from './_auth.mjs';
const BASE = 'http://localhost:3000';
const req = withLoginCode(rawReq);
let failed = 0;

function assert(cond, msg) {
  if (cond) console.log('✅', msg);
  else { console.error('❌', msg); failed++; }
}

async function rawReq(method, path, body, token) {
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
    email: `mat-a-${s}@example.com`, name: 'Admin A', companyName: `MatCo-A ${s}`,
  });
  const b = await req('POST', '/auth/register-company', {
    email: `mat-b-${s}@example.com`, name: 'Admin B', companyName: `MatCo-B ${s}`,
  });
  const ua = await req('POST', '/auth/join-company', {
    email: `mat-ua-${s}@example.com`, name: 'User A',
    invitationCode: a.json.company.invitationCode,
  });
  assert(a.status === 201 && b.status === 201 && ua.status === 201, 'setup companies + user');
  const tA = a.json.token, tB = b.json.token, tUA = ua.json.token;

  console.log('\n── Create ─────────────────────────────────────────');
  const copperA = await req('POST', '/admin/materials', {
    name: `Copper Wire ${s}`, unit: 'KG', lowStockThreshold: '5.5',
  }, tA);
  assert(copperA.status === 201, 'A creates material → 201');
  assert(copperA.json.material.unit === 'KG', 'unit stored');
  assert(copperA.json.material.lowStockThreshold === '5.5', 'decimal threshold 5.5 preserved');
  assert(copperA.json.material.currentStock === '0', 'currentStock starts at 0');

  const copperB = await req('POST', '/admin/materials', {
    name: `Copper Wire ${s}`, unit: 'KG', lowStockThreshold: '0.0001',
  }, tB);
  assert(copperB.status === 201, 'B creates same name in different company → 201');
  assert(copperB.json.material.id !== copperA.json.material.id, 'different ids across companies');
  assert(copperB.json.material.lowStockThreshold === '0.0001', '0.0001 preserved to 4 places');

  const dup = await req('POST', '/admin/materials', {
    name: `Copper Wire ${s}`, unit: 'KG',
  }, tA);
  assert(dup.status === 409, 'duplicate name in same company → 409');

  console.log('\n── Validation ─────────────────────────────────────');
  const badUnit = await req('POST', '/admin/materials', { name: 'X', unit: 'POUNDS' }, tA);
  assert(badUnit.status === 400, 'invalid unit → 400');

  const tooManyDecimals = await req('POST', '/admin/materials', {
    name: `Bad ${s}`, unit: 'KG', lowStockThreshold: '1.23456',
  }, tA);
  assert(tooManyDecimals.status === 400, '5 decimal places → 400');

  const negative = await req('POST', '/admin/materials', {
    name: `Neg ${s}`, unit: 'KG', lowStockThreshold: '-1',
  }, tA);
  assert(negative.status === 400, 'negative threshold → 400');

  const badId = await req('GET', '/admin/materials/abc', null, tA);
  assert(badId.status === 400, 'non-numeric id → 400');

  console.log('\n── Isolation: list scoping ────────────────────────');
  const listA = await req('GET', '/admin/materials', null, tA);
  const listB = await req('GET', '/admin/materials', null, tB);
  assert(listA.status === 200, 'A lists materials → 200');
  assert(listB.status === 200, 'B lists materials → 200');
  const idsA = new Set(listA.json.materials.map((m) => m.id));
  const idsB = new Set(listB.json.materials.map((m) => m.id));
  assert(!idsA.has(copperB.json.material.id), 'A does NOT see B material  ← ISOLATION');
  assert(!idsB.has(copperA.json.material.id), 'B does NOT see A material  ← ISOLATION');

  console.log('\n── Isolation: read/update by id ───────────────────');
  const crossRead = await req('GET', `/admin/materials/${copperB.json.material.id}`, null, tA);
  assert(crossRead.status === 404, 'A reading B material by id → 404 (no leak)');

  const crossUpdate = await req('PATCH', `/admin/materials/${copperB.json.material.id}`,
    { name: 'Hijacked' }, tA);
  assert(crossUpdate.status === 404, 'A updating B material → 404');

  const crossDeactivate = await req('PATCH', `/admin/materials/${copperB.json.material.id}`,
    { active: false }, tA);
  assert(crossDeactivate.status === 404, 'A deactivating B material → 404');

  const bAfter = await req('GET', `/admin/materials/${copperB.json.material.id}`, null, tB);
  assert(bAfter.json.material.name === `Copper Wire ${s}`, 'B material name untouched');
  assert(bAfter.json.material.active === true, 'B material still active');

  console.log('\n── Legitimate update within A ─────────────────────');
  const upd = await req('PATCH', `/admin/materials/${copperA.json.material.id}`, {
    name: `Copper Wire v2 ${s}`, lowStockThreshold: '10',
  }, tA);
  assert(upd.status === 200, 'A updates own material → 200');
  assert(upd.json.material.name === `Copper Wire v2 ${s}`, 'name updated');
  assert(upd.json.material.lowStockThreshold === '10', 'threshold updated');
  assert(upd.json.material.unit === 'KG', 'unit unchanged');

  const tryUnit = await req('PATCH', `/admin/materials/${copperA.json.material.id}`, { unit: 'G' }, tA);
  assert(tryUnit.status === 400, 'attempting to change unit → 400 (strict schema)');
  const afterUnit = await req('GET', `/admin/materials/${copperA.json.material.id}`, null, tA);
  assert(afterUnit.json.material.unit === 'KG', 'unit still KG after rejected update');

  console.log('\n── Deactivate + reactivate ────────────────────────');
  const deact = await req('PATCH', `/admin/materials/${copperA.json.material.id}`, { active: false }, tA);
  assert(deact.status === 200 && deact.json.material.active === false, 'deactivate works');

  const activeOnly = await req('GET', '/admin/materials?active=true', null, tA);
  assert(
    !activeOnly.json.materials.find((m) => m.id === copperA.json.material.id),
    'deactivated excluded from ?active=true',
  );

  const react = await req('PATCH', `/admin/materials/${copperA.json.material.id}`, { active: true }, tA);
  assert(react.status === 200 && react.json.material.active === true, 'reactivate works');

  console.log('\n── Role enforcement ───────────────────────────────');
  const userList = await req('GET', '/admin/materials', null, tUA);
  assert(userList.status === 403, 'regular user lists materials → 403');
  const userCreate = await req('POST', '/admin/materials', { name: 'Nope', unit: 'KG' }, tUA);
  assert(userCreate.status === 403, 'regular user creates material → 403');

  console.log('');
  if (failed) { console.error(`❌ ${failed} check(s) failed`); process.exit(1); }
  console.log('🎉 ALL MATERIAL CRUD + ISOLATION CHECKS PASSED');
}

main().catch((e) => { console.error('test crashed:', e); process.exit(1); });
