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
    email: `rev-a-${s}@example.com`, name: 'Admin A', companyName: `RevCo-A ${s}`,
  });
  const ua = await req('POST', '/auth/join-company', {
    email: `rev-ua-${s}@example.com`, name: 'User A',
    invitationCode: a.json.company.invitationCode,
  });
  const b = await req('POST', '/auth/register-company', {
    email: `rev-b-${s}@example.com`, name: 'Admin B', companyName: `RevCo-B ${s}`,
  });
  const tA = a.json.token, tUA = ua.json.token, tB = b.json.token;
  assert(a.status === 201 && ua.status === 201 && b.status === 201, 'bootstrap');

  console.log('\n── Setup: material + battery + recipe ─────────────');
  const copper = await req('POST', '/admin/materials',
    { name: `Copper ${s}`, unit: 'KG', lowStockThreshold: '5' }, tA);
  const bt = await req('POST', '/admin/battery-types',
    { name: `AA-${s}`, lowStockThreshold: 20 }, tA);
  const copperId = copper.json.material.id;
  const btid = bt.json.batteryType.id;
  await req('POST', `/admin/battery-types/${btid}/recipes`, {
    items: [{ rawMaterialId: copperId, quantityPerUnit: '0.5' }],
  }, tA);
  await req('POST', `/admin/materials/${copperId}/adjust`, { quantityChange: '10', reason: 'Initial stock' }, tA);
  assert(true, 'setup complete');

  console.log('\n── Low-stock: empty initially ─────────────────────');
  const ls1 = await req('GET', '/admin/low-stock', null, tA);
  assert(ls1.status === 200, 'GET /admin/low-stock → 200');
  assert(ls1.json.materials.length === 0, 'copper at 10 not low (threshold 5)');
  assert(ls1.json.batteries.length === 1, 'battery at 0 IS low (0 < threshold 20)');

  console.log('\n── Approve a request → stock changes ──────────────');
  const submit = await req('POST', '/production-requests',
    { batteryTypeId: btid, quantity: 4 }, tUA);
  const reqId = submit.json.request.id;
  const approve = await req('POST', `/admin/production-requests/${reqId}/approve`, null, tA);
  assert(approve.status === 200, 'approve → 200');
  const matAfterApprove = await req('GET', `/admin/materials/${copperId}`, null, tA);
  assert(matAfterApprove.json.material.currentStock === '8',
    'copper: 10 - 2 (4 × 0.5) = 8');
  const btAfterApprove = await req('GET', `/admin/battery-types/${btid}`, null, tA);
  assert(btAfterApprove.json.batteryType.currentStock === 4, 'battery: 0 + 4 = 4');

  console.log('\n── Low-stock: copper now below threshold ──────────');
  const ls2 = await req('GET', '/admin/low-stock', null, tA);
  const copperLow = ls2.json.materials.find((m) => m.id === copperId);
  assert(copperLow === undefined, 'copper at 8 STILL not below threshold 5');

  await req('POST', `/admin/materials/${copperId}/adjust`,
    { quantityChange: '-4', reason: 'Test drive below threshold' }, tA);
  const ls3 = await req('GET', '/admin/low-stock', null, tA);
  const copperLow2 = ls3.json.materials.find((m) => m.id === copperId);
  assert(copperLow2 !== undefined, 'copper at 4 IS below threshold 5 → appears');
  assert(copperLow2.currentStock === '4', 'currentStock = 4');
  assert(copperLow2.gap === '1', 'gap = 5 - 4 = 1');
  assert(copperLow2.unit === 'KG', 'unit = KG');

  // Restore copper for reversal test
  await req('POST', `/admin/materials/${copperId}/adjust`,
    { quantityChange: '4', reason: 'Restore' }, tA);

  console.log('\n── Low-stock: battery has been consumed ───────────');
  // Battery: threshold 20, current 4 → low
  const btLow = ls3.json.batteries.find((x) => x.id === btid);
  assert(btLow !== undefined, 'battery at 4 IS below threshold 20 → appears');
  assert(btLow.currentStock === 4, 'battery currentStock = 4');
  assert(btLow.gap === 16, 'battery gap = 20 - 4 = 16');

  console.log('\n── Reverse an APPROVED request ────────────────────');
  const rev = await req('POST', `/admin/production-requests/${reqId}/reverse`,
    { reason: 'Customer cancelled' }, tA);
  assert(rev.status === 200, 'reverse → 200');
  assert(rev.json.request.status === 'REVERSED', 'status = REVERSED');
  assert(rev.json.request.reversalReason === 'Customer cancelled', 'reversalReason stored');
  assert(rev.json.request.reversedAt !== null, 'reversedAt set');

  const matAfterRev = await req('GET', `/admin/materials/${copperId}`, null, tA);
  assert(matAfterRev.json.material.currentStock === '10',
    'copper restored: 8 + 2 = 10');
  const btAfterRev = await req('GET', `/admin/battery-types/${btid}`, null, tA);
  assert(btAfterRev.json.batteryType.currentStock === 0,
    'battery removed: 4 - 4 = 0');

  console.log('\n── Reversal ledger entries ────────────────────────');
  const copperLedger = await req('GET', `/admin/materials/${copperId}/movements`, null, tA);
  const copperReversals = copperLedger.json.movements.filter((m) => m.movementType === 'REVERSAL');
  assert(copperReversals.length === 1, 'copper has 1 REVERSAL movement');
  assert(copperReversals[0].quantityChange === '2', 'copper reversal = +2');
  assert(copperReversals[0].referenceType === 'PRODUCTION_REQUEST_REVERSAL',
    'referenceType = PRODUCTION_REQUEST_REVERSAL');
  assert(copperReversals[0].referenceId === reqId, 'referenceId = request id');

  const btLedger = await req('GET', `/admin/battery-types/${btid}/movements`, null, tA);
  const btReversals = btLedger.json.movements.filter((m) => m.movementType === 'REVERSAL');
  assert(btReversals.length === 1, 'battery has 1 REVERSAL movement');
  assert(btReversals[0].quantityChange === '-4', 'battery reversal = -4');

  console.log('\n── Ledger invariant after reversal ────────────────');
  assert(
    String(matAfterRev.json.material.currentStock) === copperLedger.json.sumQuantityChange,
    'copper: currentStock == sum(quantityChange)',
  );
  assert(
    String(btAfterRev.json.batteryType.currentStock) === btLedger.json.sumQuantityChange,
    'battery: currentStock == sum(quantityChange)',
  );

  console.log('\n── Cannot reverse non-APPROVED statuses ───────────');
  const revAgain = await req('POST', `/admin/production-requests/${reqId}/reverse`,
    { reason: 'Again' }, tA);
  assert(revAgain.status === 400, 'reverse already-REVERSED → 400');
  assert(revAgain.json.code === 'NOT_APPROVED', 'code = NOT_APPROVED');

  const pending2 = await req('POST', '/production-requests',
    { batteryTypeId: btid, quantity: 2 }, tUA);
  const revPending = await req('POST', `/admin/production-requests/${pending2.json.request.id}/reverse`,
    { reason: 'x' }, tA);
  assert(revPending.status === 400, 'reverse PENDING → 400');
  assert(revPending.json.code === 'NOT_APPROVED', 'code = NOT_APPROVED (pending)');

  // Reject a fresh request, then try to reverse it
  const rejReq = await req('POST', '/production-requests',
    { batteryTypeId: btid, quantity: 3 }, tUA);
  await req('POST', `/admin/production-requests/${rejReq.json.request.id}/reject`,
    { reason: 'No capacity' }, tA);
  const revRejected = await req('POST', `/admin/production-requests/${rejReq.json.request.id}/reverse`,
    { reason: 'x' }, tA);
  assert(revRejected.status === 400, 'reverse REJECTED → 400');
  assert(revRejected.json.code === 'NOT_APPROVED', 'code = NOT_APPROVED (rejected)');

  console.log('\n── Reversal requires reason ───────────────────────');
  const pending3 = await req('POST', '/production-requests',
    { batteryTypeId: btid, quantity: 1 }, tUA);
  await req('POST', `/admin/production-requests/${pending3.json.request.id}/approve`, null, tA);
  const revNoReason = await req('POST',
    `/admin/production-requests/${pending3.json.request.id}/reverse`, {}, tA);
  assert(revNoReason.status === 400, 'reverse without reason → 400');

  console.log('\n── Reversal blocked when batteries dispatched ─────');
  // Current state: pending3 was approved (battery +1). Let's dispatch it away.
  const beforeDispatch = await req('GET', `/admin/battery-types/${btid}`, null, tA);
  const dispatchable = beforeDispatch.json.batteryType.currentStock;
  await req('POST', `/admin/battery-types/${btid}/dispatches`,
    { quantity: dispatchable, traderName: 'Trader X' }, tA);

  const revBlocked = await req('POST',
    `/admin/production-requests/${pending3.json.request.id}/reverse`,
    { reason: 'Try to reverse after dispatch' }, tA);
  assert(revBlocked.status === 400, 'reverse after dispatch → 400');
  assert(revBlocked.json.code === 'INSUFFICIENT_BATTERY_FOR_REVERSAL',
    'code = INSUFFICIENT_BATTERY_FOR_REVERSAL');
  assert(revBlocked.json.details?.batteryTypeName === `AA-${s}`,
    'details includes battery type name');

  // Verify atomicity: nothing moved
  const afterBlocked = await req('GET', `/admin/production-requests/${pending3.json.request.id}`, null, tA);
  assert(afterBlocked.json.request.status === 'APPROVED',
    'request still APPROVED after failed reversal');
  const matAfterBlocked = await req('GET', `/admin/materials/${copperId}`, null, tA);
  assert(matAfterBlocked.json.material.currentStock === '9.5',
    'copper unchanged (9.5) after failed reversal');

  console.log('\n── Isolation: cross-company reversal ─────────────');
  const crossRev = await req('POST',
    `/admin/production-requests/${pending3.json.request.id}/reverse`,
    { reason: 'x' }, tB);
  assert(crossRev.status === 404, 'B reversing A request → 404  ← ISOLATION');

  console.log('\n── Role: regular user cannot reverse ──────────────');
  const userRev = await req('POST',
    `/admin/production-requests/${pending3.json.request.id}/reverse`,
    { reason: 'x' }, tUA);
  assert(userRev.status === 403, 'regular user reversing → 403');

  console.log('\n── History preserved after reversal ───────────────');
  const hist = await req('GET', `/admin/production-requests/${reqId}`, null, tA);
  const evTypes = hist.json.events.map((e) => e.eventType);
  assert(evTypes.includes('SUBMITTED'), 'history has SUBMITTED');
  assert(evTypes.includes('APPROVED'), 'history has APPROVED');
  assert(evTypes.includes('REVERSED'), 'history has REVERSED');
  assert(hist.json.request.recipeSnapshot !== null, 'recipeSnapshot still present');

  console.log('');
  if (failed) { console.error(`❌ ${failed} check(s) failed`); process.exit(1); }
  console.log('🎉 ALL REVERSAL + LOW-STOCK CHECKS PASSED');
}

main().catch((e) => { console.error('test crashed:', e); process.exit(1); });
