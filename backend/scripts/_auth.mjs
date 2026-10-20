// Register/join now need an emailed one-time code. In dev (EMAIL_PROVIDER=console)
// /auth/request-code returns it as `devCode`, so tests can complete the flow.
//
// withLoginCode(req) wraps a script's `req(method, path, body, token)` helper so
// existing calls to /auth/register-company and /auth/join-company keep working.
export function withLoginCode(req) {
  return async (method, path, body, token) => {
    const intent =
      path === '/auth/register-company' ? 'register'
      : path === '/auth/join-company' ? 'join'
      : null;
    if (method !== 'POST' || !intent || !body || body.code) {
      return req(method, path, body, token);
    }

    const sent = await req('POST', '/auth/request-code', {
      intent,
      email: body.email,
      ...(intent === 'join' ? { invitationCode: body.invitationCode } : {}),
    });
    // Surface request-code failures (e.g. 409 already a member) as the call's result
    if (sent.status !== 200) return sent;
    if (!sent.json.devCode) {
      throw new Error('No devCode returned: use @example.com emails and a non-production server');
    }
    return req(method, path, { ...body, code: sent.json.devCode }, token);
  };
}
