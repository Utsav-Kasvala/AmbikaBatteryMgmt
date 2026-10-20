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

const wrongCode = (code) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

async function main() {
  const s = Date.now();
  const adminEmail = `otp-admin-${s}@example.com`;
  const userEmail = `otp-user-${s}@example.com`;

  console.log('\n── request-code validation ────────────────────────');
  let r = await req('POST', '/auth/request-code', { intent: 'signin', email: adminEmail });
  assert(r.status === 404 && r.json.code === 'NO_ACCOUNT', 'sign-in code for unknown email → 404 NO_ACCOUNT');
  r = await req('POST', '/auth/request-code', { intent: 'bogus', email: adminEmail });
  assert(r.status === 400, 'unknown intent → 400');
  r = await req('POST', '/auth/request-code', { intent: 'join', email: userEmail, invitationCode: 'AMB-NOPE0000' });
  assert(r.status === 400 && r.json.code === 'INVALID_CODE', 'join code with bad invite → 400 INVALID_CODE');

  console.log('\n── Register requires a valid code ─────────────────');
  r = await req('POST', '/auth/register-company', { email: adminEmail, name: 'A', companyName: `OTP Co ${s}` });
  assert(r.status === 400, 'register without code → 400');
  const regCode = await req('POST', '/auth/request-code', { intent: 'register', email: adminEmail });
  assert(regCode.status === 200 && /^\d{6}$/.test(regCode.json.devCode ?? ''), 'register code issued (devCode in dev)');
  r = await req('POST', '/auth/register-company', {
    email: adminEmail, name: 'A', companyName: `OTP Co ${s}`, code: wrongCode(regCode.json.devCode),
  });
  assert(r.status === 400 && r.json.code === 'OTP_INVALID' && /4 attempts left/.test(r.json.error), 'wrong code → 400 OTP_INVALID, 4 left');
  r = await req('POST', '/auth/request-code', { intent: 'register', email: adminEmail });
  assert(r.status === 429 && r.json.code === 'CODE_COOLDOWN', 'resend within 30s → 429 CODE_COOLDOWN');
  const reg = await req('POST', '/auth/register-company', {
    email: adminEmail, name: 'A', companyName: `OTP Co ${s}`, code: regCode.json.devCode,
  });
  assert(reg.status === 201 && reg.json.user.role === 'ADMIN', 'register with right code → 201 ADMIN');
  assert(!!reg.json.company.invitationCode, 'admin gets invitation code');
  r = await req('POST', '/auth/register-company', {
    email: adminEmail, name: 'A', companyName: `OTP Co2 ${s}`, code: regCode.json.devCode,
  });
  assert(r.status === 400 && r.json.code === 'OTP_EXPIRED', 'reusing a consumed code → 400 OTP_EXPIRED');
  const invite = reg.json.company.invitationCode;

  console.log('\n── Join requires a code; duplicate caught early ───');
  const joinCode = await req('POST', '/auth/request-code', { intent: 'join', email: userEmail, invitationCode: invite.toLowerCase() });
  assert(joinCode.status === 200, 'join code issued (lowercase invite accepted)');
  const join = await req('POST', '/auth/join-company', {
    email: userEmail, name: 'U', invitationCode: invite, code: joinCode.json.devCode,
  });
  assert(join.status === 201 && join.json.user.role === 'USER', 'join with code → 201 USER');
  assert(join.json.company.invitationCode === undefined, 'regular user does NOT get invitation code');
  r = await req('POST', '/auth/request-code', { intent: 'join', email: userEmail, invitationCode: invite });
  assert(r.status === 409 && r.json.code === 'EMAIL_TAKEN', 'join code for existing member → 409 before any email');
  const meUser = await req('GET', '/auth/me', null, join.json.token);
  assert(meUser.status === 200 && meUser.json.company.invitationCode === undefined, '/auth/me hides invitation code from users');

  console.log('\n── Sign in (single company) ───────────────────────');
  await req('POST', '/auth/logout', null, reg.json.token);
  const signCode = await req('POST', '/auth/request-code', { intent: 'signin', email: ` ${adminEmail.toUpperCase()} ` });
  assert(signCode.status === 200, 'sign-in code issued (email normalized)');
  r = await req('POST', '/auth/sign-in', { email: adminEmail, code: '12' });
  assert(r.status === 400 && r.json.code === 'VALIDATION_ERROR', 'malformed code → validation error');
  const signIn = await req('POST', '/auth/sign-in', { email: adminEmail, code: signCode.json.devCode });
  assert(signIn.status === 200 && signIn.json.token && signIn.json.user.id === reg.json.user.id, 'sign-in → token for the same admin');
  const meAdmin = await req('GET', '/auth/me', null, signIn.json.token);
  assert(meAdmin.status === 200 && meAdmin.json.company.id === reg.json.company.id && !!meAdmin.json.company.invitationCode, 'session works; admin sees invite');
  r = await req('POST', '/auth/sign-in', { email: adminEmail, code: signCode.json.devCode });
  assert(r.status === 400 && r.json.code === 'OTP_EXPIRED', 'sign-in code is single-use');

  console.log('\n── Lockout after 5 wrong attempts ─────────────────');
  const lockCode = await req('POST', '/auth/request-code', { intent: 'signin', email: userEmail });
  for (let i = 0; i < 5; i++) {
    r = await req('POST', '/auth/sign-in', { email: userEmail, code: wrongCode(lockCode.json.devCode) });
  }
  assert(r.status === 400 && r.json.code === 'OTP_LOCKED', '5th wrong attempt → OTP_LOCKED');
  r = await req('POST', '/auth/sign-in', { email: userEmail, code: lockCode.json.devCode });
  assert(r.status === 429 && r.json.code === 'OTP_LOCKED', 'correct code after lockout still rejected');

  console.log('\n── Email in two companies → choose company ────────');
  const coB = await req('POST', '/auth/request-code', { intent: 'register', email: `otp-b-${s}@example.com` });
  const regB = await req('POST', '/auth/register-company', {
    email: `otp-b-${s}@example.com`, name: 'B', companyName: `OTP Co B ${s}`, code: coB.json.devCode,
  });
  // admin of company A joins company B as a user with the same email
  const jc = await req('POST', '/auth/request-code', { intent: 'join', email: adminEmail, invitationCode: regB.json.company.invitationCode });
  const joinB = await req('POST', '/auth/join-company', {
    email: adminEmail, name: 'A in B', invitationCode: regB.json.company.invitationCode, code: jc.json.devCode,
  });
  assert(joinB.status === 201, 'same email joins second company');
  const multiCode = await req('POST', '/auth/request-code', { intent: 'signin', email: adminEmail });
  const pick = await req('POST', '/auth/sign-in', { email: adminEmail, code: multiCode.json.devCode });
  assert(pick.status === 200 && pick.json.needsCompany === true && pick.json.companies.length === 2 && !pick.json.token,
    'multi-company sign-in → needsCompany with 2 options, no token yet');
  r = await req('POST', '/auth/sign-in', { email: adminEmail, code: multiCode.json.devCode, companyId: 999999999 });
  assert(r.status === 400 && r.json.code === 'NOT_A_MEMBER', 'picking a non-member company → 400');
  const intoB = await req('POST', '/auth/sign-in', { email: adminEmail, code: multiCode.json.devCode, companyId: regB.json.company.id });
  assert(intoB.status === 200 && intoB.json.company.id === regB.json.company.id && intoB.json.user.role === 'USER',
    'sign in to chosen company B as USER');
  const meB = await req('GET', '/auth/me', null, intoB.json.token);
  assert(meB.json.company.id === regB.json.company.id, '/auth/me confirms company B');

  console.log('');
  if (failed) {
    console.error(`❌ ${failed} check(s) failed`);
    process.exit(1);
  }
  console.log('🎉 ALL OTP AUTH CHECKS PASSED');
}

main().catch((e) => { console.error('test crashed:', e); process.exit(1); });
