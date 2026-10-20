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

  console.log('\n── Bootstrap: company, admin, user ────────────────');
  const a = await req('POST', '/auth/register-company', {
    email: `pr-a-${s}@example.com`, name: 'Admin A', companyName: `PrCo-A ${s}`,
  });
  const ua = await req('POST', '/auth/join-company', {
    email: `pr-ua-${s}@example.com`, name: 'User A',
    invitationCode: a.json.company.invitationCode,
  });
  const b = await req('POST', '/auth/register-company', {
    email: `pr-b-${s}@example.com`, name: 'Admin B', companyName: `PrCo-B ${s}`,
  });
  assert(a.status === 201 && ua.status === 201 && b.status === 201, 'bootstrap');
  const tA = a.json.token, tUA = ua.json.token, tB = b.json.token;

  console.log('\n── Admin A prepares material + battery + recipe ───');
  const copper = await req('POST', '/admin/materials',
    { name: `Copper ${s}`, unit: 'KG' }, tA);
  const acid = await req('POST', '/admin/materials',
    { name: `Acid ${s}`, unit: 'LITRES' }, tA);
  const bt = await req('POST', '/admin/battery-types',
    { name: `AA-${s}` }, tA);
  const recipe = await req('POST', `/admin/battery-types/${bt.json.batteryType.id}/recipes`, {
    items: [
      { rawMaterialId: copper.json.material.id, quantityPerUnit: '0.005' },
      { rawMaterialId: acid.json.material.id,   quantityPerUnit: '0.02' },
    ],
  }, tA);
  assert(
    copper.status === 201 && acid.status === 201 && bt.status === 201 && recipe.status === 201,
    'setup complete',
  );
  const btid = bt.json.batteryType.id;

  console.log('\n── No active recipe → 400 ─────────────────────────');
  const btNoRecipe = await req('POST', '/admin/battery-types',
    { name: `NoRecipe-${s}` }, tA);
  const submitNoRecipe = await req('POST', '/production-requests', {
    batteryTypeId: btNoRecipe.json.batteryType.id,
    quantity: 10,
  }, tUA);
  assert(submitNoRecipe.status === 400, 'no active recipe → 400');
  assert(submitNoRecipe.json.code === 'NO_ACTIVE_RECIPE', 'code = NO_ACTIVE_RECIPE');

  console.log('\n── Deactivated battery type → 400 ─────────────────');
  const btOff = await req('POST', '/admin/battery-types',
    { name: `Off-${s}` }, tA);
  await req('PATCH', `/admin/battery-types/${btOff.json.batteryType.id}`, { active: false }, tA);
  const submitOff = await req('POST', '/production-requests', {
    batteryTypeId: btOff.json.batteryType.id,
    quantity: 10,
  }, tUA);
  assert(submitOff.status === 400, 'deactivated battery type → 400');

  console.log('\n── Submit production request ──────────────────────');
  const submit = await req('POST', '/production-requests', {
    batteryTypeId: btid, quantity: 100,
  }, tUA);
  assert(submit.status === 201, 'submit → 201');
  assert(submit.json.request.status === 'PENDING', 'status = PENDING');
  assert(submit.json.request.quantity === 100, 'quantity = 100');
  assert(submit.json.request.batteryTypeId === btid, 'batteryTypeId matches');
  const requestId = submit.json.request.id;
  const snap = submit.json.request.recipeSnapshot;
  assert(snap.version === 1, 'snapshot version = 1');
  assert(snap.materials.length === 2, 'snapshot has 2 materials');
  const copperSnap = snap.materials.find((m) => m.rawMaterialId === copper.json.material.id);
  assert(copperSnap.quantityPerUnit === '0.005', 'snapshot copper qty/unit = 0.005');
  assert(copperSnap.totalRequired === '0.5', 'snapshot copper totalRequired = 0.5 (0.005 × 100)');
  const acidSnap = snap.materials.find((m) => m.rawMaterialId === acid.json.material.id);
  assert(acidSnap.totalRequired === '2', 'snapshot acid totalRequired = 2 (0.02 × 100)');

  console.log('\n── PENDING does not touch stock ───────────────────');
  const copperAfter = await req('GET', `/admin/materials/${copper.json.material.id}`, null, tA);
  const btAfter = await req('GET', `/admin/battery-types/${btid}`, null, tA);
  assert(copperAfter.json.material.currentStock === '0', 'copper stock still 0');
  assert(btAfter.json.batteryType.currentStock === 0, 'battery stock still 0');

  console.log('\n── List own requests ──────────────────────────────');
  const listUA = await req('GET', '/production-requests', null, tUA);
  assert(listUA.status === 200, 'list own → 200');
  assert(listUA.json.requests.length === 1, 'UA sees exactly 1 request (own)');
  assert(listUA.json.requests[0].id === requestId, 'own request visible');

  const listAdmin = await req('GET', '/production-requests', null, tA);
  assert(listAdmin.json.requests.length === 0, 'Admin A sees 0 (owns none)');

  console.log('\n── View own request by id ─────────────────────────');
  const view = await req('GET', `/production-requests/${requestId}`, null, tUA);
  assert(view.status === 200, 'view own → 200');
  assert(view.json.request.id === requestId, 'correct request');

  console.log('\n── Cross-company isolation ────────────────────────');
  const crossView = await req('GET', `/production-requests/${requestId}`, null, tB);
  assert(crossView.status === 404, 'B viewing A request → 404  ← ISOLATION');
  const crossList = await req('GET', '/production-requests', null, tB);
  assert(crossList.json.requests.length === 0, 'B list empty');

  // Another user in same company cannot see UA's request either
  const ub = await req('POST', '/auth/join-company', {
    email: `pr-ub-${s}@example.com`, name: 'User B',
    invitationCode: a.json.company.invitationCode,
  });
  const listUB = await req('GET', '/production-requests', null, ub.json.token);
  assert(listUB.json.requests.length === 0, 'other user in same company sees 0  ← user isolation');
  const viewUB = await req('GET', `/production-requests/${requestId}`, null, ub.json.token);
  assert(viewUB.status === 404, 'other user in same company viewing → 404');

  console.log('\n── Edit PENDING request ───────────────────────────');
  const edit = await req('PATCH', `/production-requests/${requestId}`, { quantity: 200 }, tUA);
  assert(edit.status === 200, 'edit pending → 200');
  assert(edit.json.request.quantity === 200, 'quantity = 200');
  const snap2 = edit.json.request.recipeSnapshot;
  const copperSnap2 = snap2.materials.find((m) => m.rawMaterialId === copper.json.material.id);
  assert(copperSnap2.totalRequired === '1', 'snapshot recomputed: copper totalRequired = 1 (0.005 × 200)');
  assert(copperSnap2.quantityPerUnit === '0.005', 'quantityPerUnit unchanged in snapshot');

  const noChange = await req('PATCH', `/production-requests/${requestId}`, { quantity: 200 }, tUA);
  assert(noChange.status === 400, 'no-change edit → 400');
  assert(noChange.json.code === 'NO_CHANGES', 'code = NO_CHANGES');

  const editCross = await req('PATCH', `/production-requests/${requestId}`, { quantity: 50 }, ub.json.token);
  assert(editCross.status === 404, 'other user editing → 404  ← ISOLATION');

  console.log('\n── Validation ─────────────────────────────────────');
  const qZero = await req('POST', '/production-requests', { batteryTypeId: btid, quantity: 0 }, tUA);
  assert(qZero.status === 400, 'quantity 0 → 400');
  const qNeg = await req('POST', '/production-requests', { batteryTypeId: btid, quantity: -5 }, tUA);
  assert(qNeg.status === 400, 'quantity negative → 400');
  const qFrac = await req('POST', '/production-requests', { batteryTypeId: btid, quantity: 1.5 }, tUA);
  assert(qFrac.status === 400, 'fractional quantity → 400');
  const noBt = await req('POST', '/production-requests', { quantity: 10 }, tUA);
  assert(noBt.status === 400, 'missing batteryTypeId → 400');
  const badBt = await req('POST', '/production-requests', { batteryTypeId: 999999, quantity: 10 }, tUA);
  assert(badBt.status === 404, 'nonexistent batteryTypeId → 404');
  const crossBt = await req('POST', '/production-requests',
    { batteryTypeId: 999999, quantity: 10 }, tB);
  assert(crossBt.status === 404, 'nonexistent batteryTypeId (B) → 404');

  console.log('\n── Soft delete PENDING ────────────────────────────');
  const del = await req('DELETE', `/production-requests/${requestId}`, null, tUA);
  assert(del.status === 204, 'delete pending → 204');

  const listAfterDel = await req('GET', '/production-requests', null, tUA);
  assert(listAfterDel.json.requests.length === 0, 'deleted hidden from list');
  const viewAfterDel = await req('GET', `/production-requests/${requestId}`, null, tUA);
  assert(viewAfterDel.status === 404, 'deleted → 404 on view');

  // Cross-company delete still 404
  const delOther = await req('DELETE', `/production-requests/${requestId}`, null, tB);
  assert(delOther.status === 404, "B deleting A's deleted request → 404  ← ISOLATION");

  console.log('');
  if (failed) { console.error(`❌ ${failed} check(s) failed`); process.exit(1); }
  console.log('🎉 ALL PRODUCTION REQUEST (USER) CHECKS PASSED');
}

main().catch((e) => { console.error('test crashed:', e); process.exit(1); });
