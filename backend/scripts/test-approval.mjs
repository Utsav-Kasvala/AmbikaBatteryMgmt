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
    email: `app-a-${s}@example.com`, name: 'Admin A', companyName: `AppCo-A ${s}`,
  });
  const ua = await req('POST', '/auth/join-company', {
    email: `app-ua-${s}@example.com`, name: 'User A',
    invitationCode: a.json.company.invitationCode,
  });
  const b = await req('POST', '/auth/register-company', {
    email: `app-b-${s}@example.com`, name: 'Admin B', companyName: `AppCo-B ${s}`,
  });
  const tA = a.json.token, tUA = ua.json.token, tB = b.json.token;
  assert(a.status === 201 && ua.status === 201 && b.status === 201, 'bootstrap');

  console.log('\n── Setup: material, battery, recipe ───────────────');
  const copper = await req('POST', '/admin/materials',
    { name: `Copper ${s}`, unit: 'KG' }, tA);
  const acid = await req('POST', '/admin/materials',
    { name: `Acid ${s}`, unit: 'LITRES' }, tA);
  const bt = await req('POST', '/admin/battery-types', { name: `AA-${s}` }, tA);
  await req('POST', `/admin/battery-types/${bt.json.batteryType.id}/recipes`, {
    items: [
      { rawMaterialId: copper.json.material.id, quantityPerUnit: '0.005' },
      { rawMaterialId: acid.json.material.id,   quantityPerUnit: '0.02' },
    ],
  }, tA);
  const copperId = copper.json.material.id;
  const acidId = acid.json.material.id;
  const btid = bt.json.batteryType.id;
  assert(true, 'setup complete');

  console.log('\n── Insufficient materials blocks approval ─────────');
  // Copper: 0, Acid: 100. Need 0.5 copper + 2 acid for 100 units → copper short
  await req('POST', `/admin/materials/${acidId}/opening-stock`, { quantity: '100' }, tA);
  const submit1 = await req('POST', '/production-requests',
    { batteryTypeId: btid, quantity: 100 }, tUA);
  const req1Id = submit1.json.request.id;

  const approve1 = await req('POST', `/admin/production-requests/${req1Id}/approve`, null, tA);
  assert(approve1.status === 400, 'approval with 0 copper → 400');
  assert(approve1.json.code === 'INSUFFICIENT_MATERIALS', 'code = INSUFFICIENT_MATERIALS');
  assert(Array.isArray(approve1.json.details?.insufficiencies), 'details.insufficiencies present');
  assert(approve1.json.details.insufficiencies.length === 1, 'exactly 1 material short (copper)');
  assert(approve1.json.details.insufficiencies[0].rawMaterialId === copperId, 'short material is copper');
  assert(approve1.json.details.insufficiencies[0].required === '0.5', 'required = 0.5');
  assert(approve1.json.details.insufficiencies[0].available === '0', 'available = 0');

  // Atomicity: nothing changed
  const req1After = await req('GET', `/production-requests/${req1Id}`, null, tUA);
  assert(req1After.json.request.status === 'PENDING', 'request still PENDING after failed approval');
  const acidAfter = await req('GET', `/admin/materials/${acidId}`, null, tA);
  assert(acidAfter.json.material.currentStock === '100', 'acid stock untouched (still 100)');
  const btAfter = await req('GET', `/admin/battery-types/${btid}`, null, tA);
  assert(btAfter.json.batteryType.currentStock === 0, 'battery stock untouched (still 0)');
  const acidLedger = await req('GET', `/admin/materials/${acidId}/movements`, null, tA);
  assert(
    !acidLedger.json.movements.some((m) => m.movementType === 'PRODUCTION_CONSUMPTION'),
    'no PRODUCTION_CONSUMPTION movements written',
  );

  console.log('\n── Both materials short → both listed ─────────────');
  const submit2 = await req('POST', '/production-requests',
    { batteryTypeId: btid, quantity: 30000 }, tUA); // needs 150 copper + 600 acid — both short
  const approve2 = await req('POST', `/admin/production-requests/${submit2.json.request.id}/approve`, null, tA);
  assert(approve2.status === 400, 'approval with 2 shortages → 400');
  assert(approve2.json.details.insufficiencies.length === 2, 'both materials listed');
  await req('DELETE', `/production-requests/${submit2.json.request.id}`, null, tUA);

  console.log('\n── Happy path: approve succeeds ───────────────────');
  await req('POST', `/admin/materials/${copperId}/opening-stock`, { quantity: '1' }, tA);
  // Now copper=1, acid=100. Need 0.5 + 2 for req1 (100 units) → all sufficient.

  const approveOk = await req('POST', `/admin/production-requests/${req1Id}/approve`, null, tA);
  assert(approveOk.status === 200, 'approve → 200');
  assert(approveOk.json.request.status === 'APPROVED', 'status = APPROVED');
  assert(approveOk.json.request.approvedAt !== null, 'approvedAt set');

  const copperAfter = await req('GET', `/admin/materials/${copperId}`, null, tA);
  const acidAfter2 = await req('GET', `/admin/materials/${acidId}`, null, tA);
  const btAfter2 = await req('GET', `/admin/battery-types/${btid}`, null, tA);
  assert(copperAfter.json.material.currentStock === '0.5', 'copper deducted: 1 - 0.5 = 0.5');
  assert(acidAfter2.json.material.currentStock === '98', 'acid deducted: 100 - 2 = 98');
  assert(btAfter2.json.batteryType.currentStock === 100, 'battery stock: 0 + 100 = 100');

  // Ledger entries created with correct type + reference
  const copperLedger = await req('GET', `/admin/materials/${copperId}/movements`, null, tA);
  const consumption = copperLedger.json.movements.find((m) => m.movementType === 'PRODUCTION_CONSUMPTION');
  assert(consumption !== undefined, 'copper has PRODUCTION_CONSUMPTION movement');
  assert(consumption.quantityChange === '-0.5', 'copper consumption = -0.5');
  assert(consumption.referenceType === 'PRODUCTION_REQUEST', 'referenceType = PRODUCTION_REQUEST');
  assert(consumption.referenceId === req1Id, 'referenceId = request id');
  assert(consumption.userId === a.json.user.id, 'attributed to approver (Admin A)');

  const btLedger = await req('GET', `/admin/battery-types/${btid}/movements`, null, tA);
  const output = btLedger.json.movements.find((m) => m.movementType === 'PRODUCTION_OUTPUT');
  assert(output !== undefined, 'battery has PRODUCTION_OUTPUT movement');
  assert(output.quantityChange === '100', 'battery output = +100');
  assert(output.referenceId === req1Id, 'battery output references request');

  // Ledger invariants
  assert(
    String(copperAfter.json.material.currentStock) === copperLedger.json.sumQuantityChange,
    'copper ledger invariant holds',
  );

  console.log('\n── Approve non-pending → 400 ──────────────────────');
  const approveAgain = await req('POST', `/admin/production-requests/${req1Id}/approve`, null, tA);
  assert(approveAgain.status === 400, 'approve already-approved → 400');
  assert(approveAgain.json.code === 'NOT_PENDING', 'code = NOT_PENDING');

  console.log('\n── Approve non-existent → 404 ─────────────────────');
  const approveGhost = await req('POST', '/admin/production-requests/999999/approve', null, tA);
  assert(approveGhost.status === 404, 'approve non-existent → 404');

  console.log('\n── Concurrency: two approves in parallel ──────────');
  // Set up a fresh pending request with sufficient stock
  await req('POST', `/admin/materials/${copperId}/opening-stock`, { quantity: '10' }, tA);
  await req('POST', `/admin/materials/${acidId}/opening-stock`, { quantity: '100' }, tA);
  const submit3 = await req('POST', '/production-requests',
    { batteryTypeId: btid, quantity: 10 }, tUA);
  const req3Id = submit3.json.request.id;

  const btBefore = await req('GET', `/admin/battery-types/${btid}`, null, tA);
  const btStockBefore = btBefore.json.batteryType.currentStock;

  const [r1, r2] = await Promise.all([
    req('POST', `/admin/production-requests/${req3Id}/approve`, null, tA),
    req('POST', `/admin/production-requests/${req3Id}/approve`, null, tA),
  ]);
  const okCount = [r1, r2].filter((r) => r.status === 200).length;
  const conflictCount = [r1, r2].filter((r) => r.status === 400).length;
  assert(okCount === 1, 'exactly one concurrent approve → 200');
  assert(conflictCount === 1, 'exactly one concurrent approve → 400 (NOT_PENDING)');

  const btAfter3 = await req('GET', `/admin/battery-types/${btid}`, null, tA);
  const addedBatteries = btAfter3.json.batteryType.currentStock - btStockBefore;
  assert(addedBatteries === 10, `batteries added exactly once (added ${addedBatteries}, expected 10)`);

  console.log('\n── Reject requires reason ─────────────────────────');
  const submit4 = await req('POST', '/production-requests',
    { batteryTypeId: btid, quantity: 5 }, tUA);
  const req4Id = submit4.json.request.id;
  const rejectNoReason = await req('POST', `/admin/production-requests/${req4Id}/reject`, {}, tA);
  assert(rejectNoReason.status === 400, 'reject without reason → 400');
  const rejectEmpty = await req('POST', `/admin/production-requests/${req4Id}/reject`, { reason: '   ' }, tA);
  assert(rejectEmpty.status === 400, 'reject with whitespace reason → 400');

  console.log('\n── Reject succeeds, no stock changes ──────────────');
  const btBefore4 = await req('GET', `/admin/battery-types/${btid}`, null, tA);
  const reject = await req('POST', `/admin/production-requests/${req4Id}/reject`,
    { reason: 'Recipe mismatch' }, tA);
  assert(reject.status === 200, 'reject → 200');
  assert(reject.json.request.status === 'REJECTED', 'status = REJECTED');
  assert(reject.json.request.rejectionReason === 'Recipe mismatch', 'reason stored');
  const btAfter4 = await req('GET', `/admin/battery-types/${btid}`, null, tA);
  assert(btAfter4.json.batteryType.currentStock === btBefore4.json.batteryType.currentStock,
    'battery stock unchanged by rejection');

  console.log('\n── Reject non-pending → 400 ───────────────────────');
  const rejectAgain = await req('POST', `/admin/production-requests/${req4Id}/reject`,
    { reason: 'Again' }, tA);
  assert(rejectAgain.status === 400, 'reject already-rejected → 400');
  assert(rejectAgain.json.code === 'NOT_PENDING', 'code = NOT_PENDING');

  console.log('\n── User resubmits rejected request ────────────────');
  const resubmit = await req('POST', `/production-requests/${req4Id}/resubmit`,
    { quantity: 8 }, tUA);
  assert(resubmit.status === 200, 'resubmit → 200');
  assert(resubmit.json.request.status === 'PENDING', 'status = PENDING after resubmit');
  assert(resubmit.json.request.quantity === 8, 'quantity updated to 8');
  assert(resubmit.json.request.rejectionReason === null, 'rejectionReason cleared');
  assert(resubmit.json.request.rejectedAt === null, 'rejectedAt cleared');
  const snap = resubmit.json.request.recipeSnapshot;
  const copperSnap = snap.materials.find((m) => m.rawMaterialId === copperId);
  assert(copperSnap.totalRequired === '0.04', 'snapshot recomputed: 0.005 × 8 = 0.04');

  console.log('\n── Resubmit non-rejected → 400 ────────────────────');
  const resubmitPending = await req('POST', `/production-requests/${req4Id}/resubmit`,
    { quantity: 9 }, tUA);
  assert(resubmitPending.status === 400, 'resubmit pending → 400');
  assert(resubmitPending.json.code === 'NOT_REJECTED', 'code = NOT_REJECTED');

  console.log('\n── History preserved through resubmit ─────────────');
  const history = await req('GET', `/admin/production-requests/${req4Id}`, null, tA);
  const evTypes = history.json.events.map((e) => e.eventType);
  assert(evTypes.includes('SUBMITTED'), 'history has SUBMITTED');
  assert(evTypes.includes('REJECTED'), 'history has REJECTED');
  assert(evTypes.includes('RESUBMITTED'), 'history has RESUBMITTED');

  console.log('\n── Cross-company + role isolation ─────────────────');
  const crossApprove = await req('POST', `/admin/production-requests/${req4Id}/approve`, null, tB);
  assert(crossApprove.status === 404, 'B approving A request → 404  ← ISOLATION');
  const crossReject = await req('POST', `/admin/production-requests/${req4Id}/reject`,
    { reason: 'x' }, tB);
  assert(crossReject.status === 404, 'B rejecting A request → 404  ← ISOLATION');

  const userApprove = await req('POST', `/admin/production-requests/${req4Id}/approve`, null, tUA);
  assert(userApprove.status === 403, 'regular user approving → 403');
  const userReject = await req('POST', `/admin/production-requests/${req4Id}/reject`,
    { reason: 'x' }, tUA);
  assert(userReject.status === 403, 'regular user rejecting → 403');

  // Another user in same company can't resubmit someone else's request
  const ub = await req('POST', '/auth/join-company', {
    email: `app-ub-${s}@example.com`, name: 'User B',
    invitationCode: a.json.company.invitationCode,
  });
  const crossResubmit = await req('POST', `/production-requests/${req4Id}/resubmit`,
    { quantity: 10 }, ub.json.token);
  assert(crossResubmit.status === 404, 'other user resubmitting → 404  ← user isolation');

  console.log('');
  if (failed) { console.error(`❌ ${failed} check(s) failed`); process.exit(1); }
  console.log('🎉 ALL APPROVAL / REJECTION / RESUBMISSION CHECKS PASSED');
}

main().catch((e) => { console.error('test crashed:', e); process.exit(1); });
