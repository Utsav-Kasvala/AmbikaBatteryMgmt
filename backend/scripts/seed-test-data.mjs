import { withLoginCode } from './_auth.mjs';
const BASE = 'http://localhost:3000';
const req = withLoginCode(rawReq);

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

  console.log('── Registering seed company ───────────────────────');
  const reg = await req('POST', '/auth/register-company', {
    email: `seed-admin-${s}@example.com`,
    name: 'Seed Admin',
    companyName: `Seed Co ${s}`,
  });
  if (reg.status !== 201) throw new Error(`register-company failed: ${JSON.stringify(reg.json)}`);
  const token = reg.json.token;
  console.log(`✅ Admin email:     ${reg.json.user.email}`);
  console.log(`✅ Company:         ${reg.json.company.name}`);
  console.log(`✅ Invitation code: ${reg.json.company.invitationCode}`);

  console.log('\n── Creating raw materials ─────────────────────────');
  const materialSpecs = [
    { name: 'Copper Wire',        unit: 'KG' },
    { name: 'Lithium Carbonate',  unit: 'KG' },
    { name: 'Sulfuric Acid',      unit: 'LITRES' },
    { name: 'Plastic Casing',     unit: 'PIECES' },
  ];
  const materials = [];
  for (const m of materialSpecs) {
    const r = await req('POST', '/admin/materials', m, token);
    if (r.status !== 201) throw new Error(`material ${m.name}: ${JSON.stringify(r.json)}`);
    materials.push(r.json.material);
    console.log(`✅ ${m.name} (${m.unit})`);
  }

  console.log('\n── Adding opening stock (100 each) ────────────────');
  for (const m of materials) {
    const r = await req('POST', `/admin/materials/${m.id}/adjust`,
      { quantityChange: '100', reason: 'Seed initial stock' }, token);
    if (r.status !== 201) throw new Error(`opening stock ${m.name}: ${JSON.stringify(r.json)}`);
    console.log(`✅ ${m.name}: 100 ${m.unit}`);
  }

  console.log('\n── Creating battery types ─────────────────────────');
  const batteryTypes = [];
  for (const bt of [
    { name: 'AA-2000mAh',  lowStockThreshold: 50 },
    { name: 'AAA-1000mAh', lowStockThreshold: 50 },
  ]) {
    const r = await req('POST', '/admin/battery-types', bt, token);
    if (r.status !== 201) throw new Error(`battery type ${bt.name}: ${JSON.stringify(r.json)}`);
    batteryTypes.push(r.json.batteryType);
    console.log(`✅ ${bt.name}`);
  }

  console.log('\n── Creating recipes (v1) ──────────────────────────');
  for (const bt of batteryTypes) {
    const r = await req('POST', `/admin/battery-types/${bt.id}/recipes`, {
      items: [
        { rawMaterialId: materials[0].id, quantityPerUnit: '0.01' },  // 10g copper
        { rawMaterialId: materials[1].id, quantityPerUnit: '0.02' },  // 20g lithium
        { rawMaterialId: materials[2].id, quantityPerUnit: '0.005' }, // 5ml acid
        { rawMaterialId: materials[3].id, quantityPerUnit: '1' },     // 1 casing
      ],
    }, token);
    if (r.status !== 201) throw new Error(`recipe ${bt.name}: ${JSON.stringify(r.json)}`);
    console.log(`✅ ${bt.name}: recipe v${r.json.recipe.version} (4 items)`);
  }

  console.log('\n' + '═'.repeat(64));
  console.log('🎉 Seed complete. On your phone:');
  console.log('');
  console.log(`   ADMIN:  Sign in → ${reg.json.user.email}`);
  console.log(`   USER:   Join → any other email + code ${reg.json.company.invitationCode}`);
  console.log('');
  console.log('   Sign-in codes: shown in the app in dev mode, or in the backend');
  console.log('   log (docker compose logs -f backend) / your inbox with Resend.');
  console.log('   Switch accounts with Settings → Sign out, then Sign in again.');
  console.log('');
  console.log('   Stock currently:');
  console.log(`   Materials:     100 units each (${materials.map(m => m.name).join(', ')})`);
  console.log(`   Battery types: 0 units each (${batteryTypes.map(b => b.name).join(', ')})`);
  console.log('═'.repeat(64));
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
