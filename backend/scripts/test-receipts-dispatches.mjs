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
    email: `rd-a-${s}@example.com`, name: 'Admin A', companyName: `RdCo-A ${s}`,
  });
  const ua = await req('POST', '/auth/join-company', {
    email: `rd-ua-${s}@example.com`, name: 'User A',
    invitationCode: a.json.company.invitationCode,
  });
  const b = await req('POST', '/auth/register-company', {
    email: `rd-b-${s}@example.com`, name: 'Admin B', companyName: `RdCo-B ${s}`,
  });
  const tA = a.json.token, tUA = ua.json.token, tB = b.json.token;
  assert(a.status === 201 && ua.status === 201 && b.status === 201, 'bootstrap');

  console.log('\n── Setup ──────────────────────────────────────────');
  const copper = await req('POST', '/admin/materials',
    { name: `Copper ${s}`, unit: 'KG' }, tA);
  const bt = await req('POST', '/admin/battery-types',
    { name: `AA-${s}`, lowStockThreshold: 30 }, tA);
  const copperId = copper.json.material.id;
  const btid = bt.json.batteryType.id;
  assert(true, 'setup complete');

  console.log('\n── Material receipt: happy path ───────────────────');
  const r1 = await req('POST', `/admin/materials/${copperId}/receipts`,
    { quantity: '10.5', notes: 'Truck 1 from vendor' }, tA);
  assert(r1.status === 201, 'receipt → 201');
  assert(r1.json.receipt.quantity === '10.5', 'receipt qty = 10.5');
  assert(r1.json.receipt.notes === 'Truck 1 from vendor', 'notes stored');
  assert(r1.json.material.currentStock === '10.5', 'material stock = 10.5');
  assert(r1.json.movement.movementType === 'RECEIPT', 'movement type = RECEIPT');
  assert(r1.json.movement.quantityChange === '10.5', 'movement qty = +10.5');
  assert(r1.json.movement.referenceType === 'RECEIPT', 'referenceType = RECEIPT');
  assert(r1.json.movement.referenceId === r1.json.receipt.id, 'referenceId = receipt.id');
  assert(r1.json.movement.userId === a.json.user.id, 'attributed to Admin A');

  const r2 = await req('POST', `/admin/materials/${copperId}/receipts`,
    { quantity: '5' }, tA);
  assert(r2.status === 201, 'second receipt → 201');
  assert(r2.json.material.currentStock === '15.5', 'stock accumulates: 10.5 + 5 = 15.5');

  console.log('\n── Material receipt: validation ───────────────────');
  const badQty5 = await req('POST', `/admin/materials/${copperId}/receipts`,
    { quantity: '1.23456' }, tA);
  assert(badQty5.status === 400, '5 decimal places → 400');
  const negQty = await req('POST', `/admin/materials/${copperId}/receipts`,
    { quantity: '-1' }, tA);
  assert(negQty.status === 400, 'negative qty → 400');
  const zeroQty = await req('POST', `/admin/materials/${copperId}/receipts`,
    { quantity: '0' }, tA);
  assert(zeroQty.status === 400, 'zero qty → 400');

  console.log('\n── Receipt: isolation ──────────────────────────────');
  const crossReceipt = await req('POST', `/admin/materials/${copperId}/receipts`,
    { quantity: '1' }, tB);
  assert(crossReceipt.status === 404, 'B receipt on A material → 404  ← ISOLATION');
  const crossList = await req('GET', `/admin/materials/${copperId}/receipts`, null, tB);
  assert(crossList.status === 404, 'B listing A receipts → 404  ← ISOLATION');

  console.log('\n── Receipt: role ──────────────────────────────────');
  const userReceipt = await req('POST', `/admin/materials/${copperId}/receipts`,
    { quantity: '1' }, tUA);
  assert(userReceipt.status === 403, 'regular user receipt → 403');

  console.log('\n── Receipt: list ──────────────────────────────────');
  const list = await req('GET', `/admin/materials/${copperId}/receipts`, null, tA);
  assert(list.status === 200, 'list receipts → 200');
  assert(list.json.total === 2, 'exactly 2 receipts (r1 + r2)');
  assert(list.json.receipts[0].quantity === '5', 'newest first (r2 first)');
  assert(list.json.receipts[1].quantity === '10.5', 'r1 second');

  console.log('\n── Dispatch: happy path ───────────────────────────');
  // Give the battery some stock via opening stock
  await req('POST', `/admin/battery-types/${btid}/adjust`, { quantityChange: 100, reason: 'Initial stock' }, tA);
  const d1 = await req('POST', `/admin/battery-types/${btid}/dispatches`,
    { quantity: 25, traderName: 'Ahmed Traders', notes: 'Order #42' }, tA);
  assert(d1.status === 201, 'dispatch → 201');
  assert(d1.json.dispatch.quantity === 25, 'dispatch qty = 25');
  assert(d1.json.dispatch.traderName === 'Ahmed Traders', 'traderName stored');
  assert(d1.json.dispatch.notes === 'Order #42', 'notes stored');
  assert(d1.json.batteryType.currentStock === 75, 'battery stock: 100 - 25 = 75');
  assert(d1.json.movement.movementType === 'DISPATCH', 'movement type = DISPATCH');
  assert(d1.json.movement.quantityChange === '-25', 'movement qty = -25');
  assert(d1.json.movement.referenceType === 'DISPATCH', 'referenceType = DISPATCH');
  assert(d1.json.movement.referenceId === d1.json.dispatch.id, 'referenceId = dispatch.id');

  console.log('\n── Dispatch: validation ───────────────────────────');
  const emptyTrader = await req('POST', `/admin/battery-types/${btid}/dispatches`,
    { quantity: 5, traderName: '   ' }, tA);
  assert(emptyTrader.status === 400, 'whitespace traderName → 400');
  const noTrader = await req('POST', `/admin/battery-types/${btid}/dispatches`,
    { quantity: 5 }, tA);
  assert(noTrader.status === 400, 'missing traderName → 400');
  const fracDispatch = await req('POST', `/admin/battery-types/${btid}/dispatches`,
    { quantity: 1.5, traderName: 'X' }, tA);
  assert(fracDispatch.status === 400, 'fractional qty → 400');
  const negDispatch = await req('POST', `/admin/battery-types/${btid}/dispatches`,
    { quantity: -5, traderName: 'X' }, tA);
  assert(negDispatch.status === 400, 'negative qty → 400');
  const zeroDispatch = await req('POST', `/admin/battery-types/${btid}/dispatches`,
    { quantity: 0, traderName: 'X' }, tA);
  assert(zeroDispatch.status === 400, 'zero qty → 400');

  console.log('\n── Dispatch: overstock guard ──────────────────────');
  const overstock = await req('POST', `/admin/battery-types/${btid}/dispatches`,
    { quantity: 1000, traderName: 'X' }, tA);
  assert(overstock.status === 400, 'dispatch > stock → 400');
  assert(overstock.json.code === 'INSUFFICIENT_STOCK', 'code = INSUFFICIENT_STOCK');
  const stockAfter = await req('GET', `/admin/battery-types/${btid}`, null, tA);
  assert(stockAfter.json.batteryType.currentStock === 75, 'stock unchanged after failed dispatch');

  console.log('\n── Dispatch: isolation ────────────────────────────');
  const crossDispatch = await req('POST', `/admin/battery-types/${btid}/dispatches`,
    { quantity: 1, traderName: 'X' }, tB);
  assert(crossDispatch.status === 404, 'B dispatch on A battery → 404  ← ISOLATION');
  const crossListD = await req('GET', `/admin/battery-types/${btid}/dispatches`, null, tB);
  assert(crossListD.status === 404, 'B listing A dispatches → 404  ← ISOLATION');

  console.log('\n── Dispatch: role ─────────────────────────────────');
  const userDispatch = await req('POST', `/admin/battery-types/${btid}/dispatches`,
    { quantity: 1, traderName: 'X' }, tUA);
  assert(userDispatch.status === 403, 'regular user dispatch → 403');

  console.log('\n── Dispatch: list ─────────────────────────────────');
  const listD = await req('GET', `/admin/battery-types/${btid}/dispatches`, null, tA);
  assert(listD.status === 200, 'list dispatches → 200');
  assert(listD.json.total === 1, 'exactly 1 dispatch');
  assert(listD.json.dispatches[0].traderName === 'Ahmed Traders', 'traderName preserved');

  console.log('\n── Concurrency: parallel dispatches ───────────────');
  // Battery stock = 75. Two parallel dispatches of 50 → only one should succeed.
  const before = await req('GET', `/admin/battery-types/${btid}`, null, tA);
  const beforeStock = before.json.batteryType.currentStock;

  const [dA, dB] = await Promise.all([
    req('POST', `/admin/battery-types/${btid}/dispatches`, { quantity: 50, traderName: 'T1' }, tA),
    req('POST', `/admin/battery-types/${btid}/dispatches`, { quantity: 50, traderName: 'T2' }, tA),
  ]);
  const ok = [dA, dB].filter((r) => r.status === 201).length;
  const fail = [dA, dB].filter((r) => r.status === 400).length;
  assert(ok === 1, 'exactly one concurrent dispatch → 201  ← NO DOUBLE DEDUCTION');
  assert(fail === 1, 'exactly one concurrent dispatch → 400');

  const after = await req('GET', `/admin/battery-types/${btid}`, null, tA);
  assert(
    after.json.batteryType.currentStock === beforeStock - 50,
    `only 50 dispatched (was ${beforeStock}, now ${after.json.batteryType.currentStock})`,
  );

  console.log('\n── Ledger invariant after all operations ──────────');
  const copperLedger = await req('GET', `/admin/materials/${copperId}/movements`, null, tA);
  const copperStock = await req('GET', `/admin/materials/${copperId}`, null, tA);
  assert(
    String(copperStock.json.material.currentStock) === copperLedger.json.sumQuantityChange,
    'copper: currentStock == sum(quantityChange)',
  );
  const btLedger = await req('GET', `/admin/battery-types/${btid}/movements`, null, tA);
  const btStock = await req('GET', `/admin/battery-types/${btid}`, null, tA);
  assert(
    String(btStock.json.batteryType.currentStock) === btLedger.json.sumQuantityChange,
    'battery: currentStock == sum(quantityChange)',
  );

  console.log('');
  if (failed) { console.error(`❌ ${failed} check(s) failed`); process.exit(1); }
  console.log('🎉 ALL RECEIPT + DISPATCH CHECKS PASSED');
}

main().catch((e) => { console.error('test crashed:', e); process.exit(1); });
