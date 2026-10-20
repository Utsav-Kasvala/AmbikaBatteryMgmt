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

  console.log('\n── Register Company A ─────────────────────────────');
  const a = await req('POST', '/auth/register-company', {
    email: `admin-a-${s}@example.com`,
    name: 'Admin A',
    companyName: `Company A ${s}`,
  });
  assert(a.status === 201, `register-company A → 201 (got ${a.status})`);
  assert(typeof a.json.token === 'string' && a.json.token.length === 64, 'A token is 64-hex');
  assert(a.json.user.role === 'ADMIN', 'first user is ADMIN');
  assert(/^AMB-[A-Z2-9]{8}$/.test(a.json.company.invitationCode), 'invitation code format AMB-XXXXXXXX');

  console.log('\n── Register Company B ─────────────────────────────');
  const b = await req('POST', '/auth/register-company', {
    email: `admin-b-${s}@example.com`,
    name: 'Admin B',
    companyName: `Company B ${s}`,
  });
  assert(b.status === 201, `register-company B → 201 (got ${b.status})`);
  assert(a.json.token !== b.json.token, 'A and B have different tokens');
  assert(a.json.company.id !== b.json.company.id, 'A and B are different companies');

  console.log('\n── /auth/me identifies caller correctly ───────────');
  const meA = await req('GET', '/auth/me', null, a.json.token);
  const meB = await req('GET', '/auth/me', null, b.json.token);
  assert(meA.status === 200, 'GET /auth/me (A) → 200');
  assert(meB.status === 200, 'GET /auth/me (B) → 200');
  assert(meA.json.user.companyId === a.json.company.id, 'A token → Company A id');
  assert(meB.json.user.companyId === b.json.company.id, 'B token → Company B id');

  console.log('\n── Admin endpoints are company-scoped ─────────────');
  const usersA = await req('GET', '/admin/users', null, a.json.token);
  const usersB = await req('GET', '/admin/users', null, b.json.token);
  assert(usersA.status === 200, 'GET /admin/users (A) → 200');
  assert(usersB.status === 200, 'GET /admin/users (B) → 200');
  const aEmails = new Set(usersA.json.users.map((u) => u.email));
  const bEmails = new Set(usersB.json.users.map((u) => u.email));
  const overlap = [...aEmails].filter((e) => bEmails.has(e));
  assert(overlap.length === 0, 'no email overlap between A and B user lists');
  assert(aEmails.has(`admin-a-${s}@example.com`), 'A sees its own admin');
  assert(!aEmails.has(`admin-b-${s}@example.com`), 'A does NOT see B admin  ← ISOLATION');
  assert(!bEmails.has(`admin-a-${s}@example.com`), 'B does NOT see A admin  ← ISOLATION');

  console.log('\n── Regular user cannot access admin route ─────────');
  const joinUserA = await req('POST', '/auth/join-company', {
    email: `user-a-${s}@example.com`,
    name: 'User A',
    invitationCode: a.json.company.invitationCode,
  });
  assert(joinUserA.status === 201, 'join-company (regular user) → 201');
  assert(joinUserA.json.user.role === 'USER', 'joined user has USER role');
  const adminAsUser = await req('GET', '/admin/users', null, joinUserA.json.token);
  assert(adminAsUser.status === 403, 'regular user → /admin/users returns 403');

  console.log('\n── Authentication failure modes ───────────────────');
  const noAuth = await req('GET', '/admin/users', null, null);
  assert(noAuth.status === 401, 'no token → 401');
  const bogus = await req('GET', '/admin/users', null, 'x'.repeat(64));
  assert(bogus.status === 401, 'bogus token → 401');
  const tampered = a.json.token.slice(0, -2) + 'aa';
  const tamperedRes = await req('GET', '/admin/users', null, tampered);
  assert(tamperedRes.status === 401, 'tampered token → 401');

  console.log('\n── Logout revokes session ─────────────────────────');
  const logout = await req('POST', '/auth/logout', null, b.json.token);
  assert(logout.status === 204, 'POST /auth/logout → 204');
  const afterLogout = await req('GET', '/auth/me', null, b.json.token);
  assert(afterLogout.status === 401, 'revoked token → 401 on next use');

  console.log('\n── Email uniqueness is per-company, not global ────');
  const dup = await req('POST', '/auth/join-company', {
    email: `user-a-${s}@example.com`,
    name: 'User A (dup)',
    invitationCode: a.json.company.invitationCode,
  });
  assert(dup.status === 409, 'duplicate email in same company → 409');
  const crossJoin = await req('POST', '/auth/join-company', {
    email: `admin-b-${s}@example.com`, // exists in Company B, not A
    name: 'Cross Email',
    invitationCode: a.json.company.invitationCode,
  });
  assert(crossJoin.status === 201, 'same email in different company → 201');

  console.log('');
  if (failed) {
    console.error(`❌ ${failed} check(s) failed`);
    process.exit(1);
  }
  console.log('🎉 ALL ISOLATION CHECKS PASSED');
}

main().catch((e) => { console.error('test crashed:', e); process.exit(1); });
