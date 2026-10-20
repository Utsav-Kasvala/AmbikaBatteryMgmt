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
    email: `rec-a-${s}@example.com`, name: 'Admin A', companyName: `RecCo-A ${s}`,
  });
  const b = await req('POST', '/auth/register-company', {
    email: `rec-b-${s}@example.com`, name: 'Admin B', companyName: `RecCo-B ${s}`,
  });
  const ua = await req('POST', '/auth/join-company', {
    email: `rec-ua-${s}@example.com`, name: 'User A',
    invitationCode: a.json.company.invitationCode,
  });
  assert(a.status === 201 && b.status === 201 && ua.status === 201, 'setup');
  const tA = a.json.token, tB = b.json.token, tUA = ua.json.token;

  console.log('\n── Materials + Battery Type ───────────────────────');
  const copperA = await req('POST', '/admin/materials',
    { name: `Copper ${s}`, unit: 'KG' }, tA);
  const acidA = await req('POST', '/admin/materials',
    { name: `Acid ${s}`, unit: 'LITRES' }, tA);
  const btA = await req('POST', '/admin/battery-types',
    { name: `AA-${s}`, lowStockThreshold: 10 }, tA);
  assert(copperA.status === 201 && acidA.status === 201 && btA.status === 201, 'created 2 materials + 1 battery type');
  const copperId = copperA.json.material.id;
  const acidId = acidA.json.material.id;
  const btId = btA.json.batteryType.id;

  console.log('\n── No recipe yet → active returns 404 ─────────────');
  const noActive = await req('GET', `/admin/battery-types/${btId}/recipes/active`, null, tA);
  assert(noActive.status === 404, 'no active recipe → 404');

  console.log('\n── Create Recipe v1 ───────────────────────────────');
  const v1 = await req('POST', `/admin/battery-types/${btId}/recipes`, {
    items: [
      { rawMaterialId: copperId, quantityPerUnit: '0.005' },
      { rawMaterialId: acidId,   quantityPerUnit: '0.02' },
    ],
  }, tA);
  assert(v1.status === 201, 'create v1 → 201');
  assert(v1.json.recipe.version === 1, 'version = 1');
  assert(v1.json.recipe.isActive === true, 'v1 isActive = true');
  assert(v1.json.recipe.items.length === 2, 'v1 has 2 items');

  const copperV1 = v1.json.recipe.items.find((i) => i.rawMaterialId === copperId);
  const acidV1 = v1.json.recipe.items.find((i) => i.rawMaterialId === acidId);
  assert(copperV1.quantityPerUnit === '0.005', 'v1 copper qty = 0.005');
  assert(acidV1.quantityPerUnit === '0.02', 'v1 acid qty = 0.02');
  assert(copperV1.rawMaterialName === `Copper ${s}`, 'v1 item includes material name');
  assert(copperV1.rawMaterialUnit === 'KG', 'v1 item includes unit');

  const activeAfterV1 = await req('GET', `/admin/battery-types/${btId}/recipes/active`, null, tA);
  assert(activeAfterV1.status === 200, 'active recipe exists after v1');
  assert(activeAfterV1.json.recipe.version === 1, 'active is v1');

  console.log('\n── Create Recipe v2 (different quantities) ────────');
  const v2 = await req('POST', `/admin/battery-types/${btId}/recipes`, {
    items: [
      { rawMaterialId: copperId, quantityPerUnit: '0.007' },
      { rawMaterialId: acidId,   quantityPerUnit: '0.03' },
    ],
  }, tA);
  assert(v2.status === 201, 'create v2 → 201');
  assert(v2.json.recipe.version === 2, 'version = 2');
  assert(v2.json.recipe.isActive === true, 'v2 isActive = true');
  const copperV2 = v2.json.recipe.items.find((i) => i.rawMaterialId === copperId);
  const acidV2 = v2.json.recipe.items.find((i) => i.rawMaterialId === acidId);
  assert(copperV2.quantityPerUnit === '0.007', 'v2 copper qty = 0.007');
  assert(acidV2.quantityPerUnit === '0.03', 'v2 acid qty = 0.03');

  console.log('\n── IMMUTABILITY: v1 unchanged after v2 created ────');
  const v1Reloaded = await req('GET', `/admin/battery-types/${btId}/recipes/${v1.json.recipe.id}`, null, tA);
  assert(v1Reloaded.status === 200, 'v1 still readable');
  assert(v1Reloaded.json.recipe.version === 1, 'v1 version still = 1');
  assert(v1Reloaded.json.recipe.isActive === false, 'v1 isActive = false after v2');
  const copperV1Reload = v1Reloaded.json.recipe.items.find((i) => i.rawMaterialId === copperId);
  const acidV1Reload = v1Reloaded.json.recipe.items.find((i) => i.rawMaterialId === acidId);
  assert(copperV1Reload.quantityPerUnit === '0.005', '✅ v1 copper STILL = 0.005  ← IMMUTABILITY');
  assert(acidV1Reload.quantityPerUnit === '0.02', '✅ v1 acid STILL = 0.02  ← IMMUTABILITY');

  const activeAfterV2 = await req('GET', `/admin/battery-types/${btId}/recipes/active`, null, tA);
  assert(activeAfterV2.json.recipe.version === 2, 'active is now v2');

  console.log('\n── List all versions ──────────────────────────────');
  const list = await req('GET', `/admin/battery-types/${btId}/recipes`, null, tA);
  assert(list.status === 200, 'list → 200');
  assert(list.json.recipes.length === 2, 'exactly 2 versions');
  assert(list.json.recipes[0].version === 2, 'list sorted desc (v2 first)');
  assert(list.json.recipes[1].version === 1, 'v1 second');

  console.log('\n── Validation ─────────────────────────────────────');
  const empty = await req('POST', `/admin/battery-types/${btId}/recipes`, { items: [] }, tA);
  assert(empty.status === 400, 'empty items → 400');

  const dup = await req('POST', `/admin/battery-types/${btId}/recipes`, {
    items: [
      { rawMaterialId: copperId, quantityPerUnit: '0.005' },
      { rawMaterialId: copperId, quantityPerUnit: '0.010' },
    ],
  }, tA);
  assert(dup.status === 400, 'duplicate material id → 400');

  const badQty = await req('POST', `/admin/battery-types/${btId}/recipes`, {
    items: [{ rawMaterialId: copperId, quantityPerUnit: '1.23456' }],
  }, tA);
  assert(badQty.status === 400, '5 decimal places → 400');

  const negQty = await req('POST', `/admin/battery-types/${btId}/recipes`, {
    items: [{ rawMaterialId: copperId, quantityPerUnit: '-1' }],
  }, tA);
  assert(negQty.status === 400, 'negative qty → 400');

  const badBtId = await req('POST', `/admin/battery-types/abc/recipes`,
    { items: [{ rawMaterialId: copperId, quantityPerUnit: '0.005' }] }, tA);
  assert(badBtId.status === 400, 'non-numeric batteryTypeId → 400');

  console.log('\n── Isolation ──────────────────────────────────────');
  // B tries to read A's battery-type recipes → 404 (not 403; no existence leak)
  const crossList = await req('GET', `/admin/battery-types/${btId}/recipes`, null, tB);
  assert(crossList.status === 404, 'B listing A recipes → 404  ← ISOLATION');

  const crossRead = await req('GET',
    `/admin/battery-types/${btId}/recipes/${v1.json.recipe.id}`, null, tB);
  assert(crossRead.status === 404, 'B reading A recipe by id → 404  ← ISOLATION');

  // B tries to create a recipe on A's battery-type → 404
  const crossCreate = await req('POST', `/admin/battery-types/${btId}/recipes`, {
    items: [{ rawMaterialId: 1, quantityPerUnit: '0.005' }],
  }, tB);
  assert(crossCreate.status === 404, 'B creating recipe on A battery-type → 404  ← ISOLATION');

  // B creates own material + battery-type, tries to use A's material → 404
  const copperB = await req('POST', '/admin/materials',
    { name: `Copper-B ${s}`, unit: 'KG' }, tB);
  const btB = await req('POST', '/admin/battery-types', { name: `BB-${s}` }, tB);
  const crossMaterial = await req('POST', `/admin/battery-types/${btB.json.batteryType.id}/recipes`, {
    items: [{ rawMaterialId: copperId, quantityPerUnit: '0.005' }],
  }, tB);
  assert(crossMaterial.status === 404, "B creating recipe using A's material → 404  ← ISOLATION");

  console.log('\n── Inactive material / deactivated battery type ───');
  const matToDeactivate = await req('POST', '/admin/materials',
    { name: `Temp ${s}`, unit: 'KG' }, tA);
  await req('PATCH', `/admin/materials/${matToDeactivate.json.material.id}`, { active: false }, tA);
  const useInactive = await req('POST', `/admin/battery-types/${btId}/recipes`, {
    items: [{ rawMaterialId: matToDeactivate.json.material.id, quantityPerUnit: '0.005' }],
  }, tA);
  assert(useInactive.status === 400, 'inactive material in recipe → 400');

  const btToDeactivate = await req('POST', '/admin/battery-types',
    { name: `TempBT-${s}` }, tA);
  await req('PATCH', `/admin/battery-types/${btToDeactivate.json.batteryType.id}`, { active: false }, tA);
  const recipeOnDeactivated = await req('POST',
    `/admin/battery-types/${btToDeactivate.json.batteryType.id}/recipes`,
    { items: [{ rawMaterialId: copperId, quantityPerUnit: '0.005' }] }, tA);
  assert(recipeOnDeactivated.status === 400, 'recipe on deactivated battery type → 400');

  // Historical recipes remain readable after battery type is deactivated
  const histRead = await req('GET',
    `/admin/battery-types/${btId}/recipes/${v1.json.recipe.id}`, null, tA);
  assert(histRead.status === 200, 'historical recipe still readable');

  console.log('\n── Role enforcement ───────────────────────────────');
  const userCreate = await req('POST', `/admin/battery-types/${btId}/recipes`, {
    items: [{ rawMaterialId: copperId, quantityPerUnit: '0.005' }],
  }, tUA);
  assert(userCreate.status === 403, 'regular user creating recipe → 403');
  const userList = await req('GET', `/admin/battery-types/${btId}/recipes`, null, tUA);
  assert(userList.status === 403, 'regular user listing recipes → 403');

  console.log('');
  if (failed) { console.error(`❌ ${failed} check(s) failed`); process.exit(1); }
  console.log('🎉 ALL RECIPE VERSION + IMMUTABILITY + ISOLATION CHECKS PASSED');
}

main().catch((e) => { console.error('test crashed:', e); process.exit(1); });
