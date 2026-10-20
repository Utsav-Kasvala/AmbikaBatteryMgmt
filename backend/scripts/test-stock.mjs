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

/** Fetches the ledger for a material and asserts currentStock == SUM(quantityChange). */
async function assertLedgerInvariant(token, kind, id) {
  const path = kind === 'material'
    ? `/admin/materials/${id}/movements?limit=500`
    : `/admin/battery-types/${id}/movements?limit=500`;
  const r = await req('GET', path, null, token);
  if (r.status !== 200) return assert(false, `ledger fetch failed (${r.status})`);
  const entity = kind === 'material' ? r.json.material : r.json.batteryType;
  const { movements, sumQuantityChange, total } = r.json;

  const currentStock = String(entity.currentStock);
  const sumStr = String(sumQuantityChange);
  assert(
    currentStock === sumStr,
    `ledger invariant ${kind}#${id}: currentStock=${currentStock} == sum(quantityChange)=${sumStr}  (${total} movements)`,
  );

  // Also verify each movement's resultingBalance equals the running total
  let running = 0;
  for (const m of movements) {
    running += parseFloat(m.quantityChange);
    const expected = String(running.toFixed(4)).replace(/\.?0+$/, '') || '0';
    const actual = String(m.resultingBalance);
    // Compare as numbers to tolerate trailing-zero formatting differences
    if (Math.abs(running - parseFloat(actual)) > 1e-9) {
      assert(false, `running balance mismatch at movement ${m.id}: expected ${running}, got ${actual}`);
      return;
    }
  }
  assert(true, `running balance matches every movement for ${kind}#${id}`);
}

async function main() {
  const s = Date.now();

  console.log('\n── Bootstrap ──────────────────────────────────────');
  const a = await req('POST', '/auth/register-company', {
    email: `stk-a-${s}@example.com`, name: 'Admin A', companyName: `StkCo-A ${s}`,
  });
  const b = await req('POST', '/auth/register-company', {
    email: `stk-b-${s}@example.com`, name: 'Admin B', companyName: `StkCo-B ${s}`,
  });
  const ua = await req('POST', '/auth/join-company', {
    email: `stk-ua-${s}@example.com`, name: 'User A',
    invitationCode: a.json.company.invitationCode,
  });
  const tA = a.json.token, tB = b.json.token, tUA = ua.json.token;
  assert(a.status === 201 && b.status === 201 && ua.status === 201, 'setup');

  console.log('\n── Material: opening stock ────────────────────────');
  const m = await req('POST', '/admin/materials', { name: `Copper ${s}`, unit: 'KG' }, tA);
  const mid = m.json.material.id;
  const open1 = await req('POST', `/admin/materials/${mid}/opening-stock`, { quantity: '10.5' }, tA);
  assert(open1.status === 201, 'opening stock → 201');
  assert(open1.json.material.currentStock === '10.5', 'currentStock = 10.5');
  assert(open1.json.movement.movementType === 'OPENING_STOCK', 'movementType = OPENING_STOCK');
  assert(open1.json.movement.resultingBalance === '10.5', 'resultingBalance = 10.5');

  const open2 = await req('POST', `/admin/materials/${mid}/opening-stock`, { quantity: '2.25', reason: 'Correction' }, tA);
  assert(open2.json.material.currentStock === '12.75', 'second opening stock accumulates → 12.75');
  await assertLedgerInvariant(tA, 'material', mid);

  console.log('\n── Material: adjustments ──────────────────────────');
  const adjPos = await req('POST', `/admin/materials/${mid}/adjust`, { quantityChange: '3', reason: 'Found extra spool' }, tA);
  assert(adjPos.status === 201, 'positive adjustment → 201');
  assert(adjPos.json.material.currentStock === '15.75', 'currentStock → 15.75');

  const adjNeg = await req('POST', `/admin/materials/${mid}/adjust`, { quantityChange: '-0.75', reason: 'Damaged in transit' }, tA);
  assert(adjNeg.status === 201, 'negative adjustment → 201');
  assert(adjNeg.json.material.currentStock === '15', 'currentStock → 15');
  await assertLedgerInvariant(tA, 'material', mid);

  console.log('\n── Material: insufficiency guard ──────────────────');
  const overdraft = await req('POST', `/admin/materials/${mid}/adjust`, { quantityChange: '-100', reason: 'Try to steal' }, tA);
  assert(overdraft.status === 400, 'overdraft attempt → 400');
  assert(overdraft.json.code === 'INSUFFICIENT_STOCK', 'error code INSUFFICIENT_STOCK');
  const stillSame = await req('GET', `/admin/materials/${mid}`, null, tA);
  assert(stillSame.json.material.currentStock === '15', 'balance unchanged after rejected overdraft');
  await assertLedgerInvariant(tA, 'material', mid);

  console.log('\n── Material: validation ───────────────────────────');
  const zeroAdj = await req('POST', `/admin/materials/${mid}/adjust`, { quantityChange: '0', reason: 'x' }, tA);
  assert(zeroAdj.status === 400, 'zero adjustment → 400');
  const noReason = await req('POST', `/admin/materials/${mid}/adjust`, { quantityChange: '1' }, tA);
  assert(noReason.status === 400, 'adjustment without reason → 400');
  const negOpen = await req('POST', `/admin/materials/${mid}/opening-stock`, { quantity: '-1' }, tA);
  assert(negOpen.status === 400, 'negative opening stock → 400');
  const zeroOpen = await req('POST', `/admin/materials/${mid}/opening-stock`, { quantity: '0' }, tA);
  assert(zeroOpen.status === 400, 'zero opening stock → 400');

  console.log('\n── Battery type: opening stock + adjustments ──────');
  const bt = await req('POST', '/admin/battery-types', { name: `AA-${s}` }, tA);
  const btid = bt.json.batteryType.id;
  const btOpen = await req('POST', `/admin/battery-types/${btid}/opening-stock`, { quantity: 100 }, tA);
  assert(btOpen.status === 201, 'battery opening stock → 201');
  assert(btOpen.json.batteryType.currentStock === 100, 'currentStock = 100');
  const btAdj = await req('POST', `/admin/battery-types/${btid}/adjust`, { quantityChange: -5, reason: 'Broken in storage' }, tA);
  assert(btAdj.status === 201, 'battery adjustment → 201');
  assert(btAdj.json.batteryType.currentStock === 95, 'currentStock = 95');
  await assertLedgerInvariant(tA, 'battery', btid);

  console.log('\n── Battery type: integer + sufficiency ────────────');
  const fracAdj = await req('POST', `/admin/battery-types/${btid}/adjust`, { quantityChange: 1.5, reason: 'x' }, tA);
  assert(fracAdj.status === 400, 'fractional battery adjustment → 400');
  const btOverdraft = await req('POST', `/admin/battery-types/${btid}/adjust`, { quantityChange: -1000, reason: 'x' }, tA);
  assert(btOverdraft.status === 400, 'battery overdraft → 400');
  assert(btOverdraft.json.code === 'INSUFFICIENT_STOCK', 'error code INSUFFICIENT_STOCK');

  console.log('\n── Isolation ──────────────────────────────────────');
  const crossOpen = await req('POST', `/admin/materials/${mid}/opening-stock`, { quantity: '1' }, tB);
  assert(crossOpen.status === 404, "B opening-stock A's material → 404  ← ISOLATION");
  const crossAdj = await req('POST', `/admin/materials/${mid}/adjust`, { quantityChange: '-1', reason: 'x' }, tB);
  assert(crossAdj.status === 404, "B adjusting A's material → 404  ← ISOLATION");
  const crossLedger = await req('GET', `/admin/materials/${mid}/movements`, null, tB);
  assert(crossLedger.status === 404, "B reading A's ledger → 404  ← ISOLATION");
  const crossBtOpen = await req('POST', `/admin/battery-types/${btid}/opening-stock`, { quantity: 1 }, tB);
  assert(crossBtOpen.status === 404, "B opening-stock A's battery → 404  ← ISOLATION");

  console.log('\n── Role enforcement ───────────────────────────────');
  const userOpen = await req('POST', `/admin/materials/${mid}/opening-stock`, { quantity: '1' }, tUA);
  assert(userOpen.status === 403, 'regular user opening-stock → 403');
  const userAdj = await req('POST', `/admin/materials/${mid}/adjust`, { quantityChange: '1', reason: 'x' }, tUA);
  assert(userAdj.status === 403, 'regular user adjusting → 403');
  const userLedger = await req('GET', `/admin/materials/${mid}/movements`, null, tUA);
  assert(userLedger.status === 403, 'regular user reading ledger → 403');

  console.log('\n── Ledger contents ────────────────────────────────');
  const ledger = await req('GET', `/admin/materials/${mid}/movements?limit=500`, null, tA);
  assert(ledger.status === 200, 'GET ledger → 200');
  assert(ledger.json.movements.length >= 4, `ledger has >= 4 movements (has ${ledger.json.movements.length})`);
  const types = ledger.json.movements.map((m) => m.movementType);
  assert(types.includes('OPENING_STOCK'), 'ledger contains OPENING_STOCK');
  assert(types.includes('ADJUSTMENT'), 'ledger contains ADJUSTMENT');
  const orderedByTime = ledger.json.movements.every((m, i, arr) =>
    i === 0 || new Date(arr[i - 1].createdAt) <= new Date(m.createdAt),
  );
  assert(orderedByTime, 'movements ordered by createdAt asc');
  assert(ledger.json.movements.every((m) => m.userId === a.json.user.id), 'every movement attributed to Admin A');

  console.log('');
  if (failed) { console.error(`❌ ${failed} check(s) failed`); process.exit(1); }
  console.log('🎉 ALL STOCK LEDGER + OPENING STOCK + ADJUSTMENT CHECKS PASSED');
}

main().catch((e) => { console.error('test crashed:', e); process.exit(1); });
