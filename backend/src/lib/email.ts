import nodemailer, { Transporter } from 'nodemailer';
import { HttpError } from './errors';

// EMAIL_PROVIDER=smtp    → any SMTP server, e.g. Gmail with an App Password
//                          (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM)
// EMAIL_PROVIDER=resend  → Resend's HTTP API (RESEND_API_KEY + EMAIL_FROM on a verified domain)
// EMAIL_PROVIDER=console → (default) prints the email to the server log; for local dev
export type EmailProvider = 'smtp' | 'resend' | 'console';

export function emailProvider(): EmailProvider {
  const p = process.env.EMAIL_PROVIDER;
  return p === 'smtp' || p === 'resend' ? p : 'console';
}

const SEND_FAILED = () =>
  new HttpError(502, 'Could not send the email. Try again shortly.', 'EMAIL_FAILED');

let smtp: Transporter | null = null;

function smtpTransport(): Transporter {
  if (smtp) return smtp;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.error('[email] EMAIL_PROVIDER=smtp but SMTP_HOST / SMTP_USER / SMTP_PASS not set');
    throw new HttpError(500, 'Email is not configured on the server', 'EMAIL_NOT_CONFIGURED');
  }
  const port = Number(SMTP_PORT) || 465;
  smtp = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465, // 465 = implicit TLS; 587 upgrades via STARTTLS
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return smtp;
}

/** Logs whether the configured provider is usable, so misconfig shows at boot, not on first sign-in. */
export async function verifyEmailConfig(): Promise<void> {
  const provider = emailProvider();
  if (provider === 'console') {
    console.log('[email] provider=console: sign-in codes are logged, not emailed');
    return;
  }
  if (provider === 'resend') {
    const ok = !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;
    console.log(`[email] provider=resend ${ok ? 'configured' : 'MISSING RESEND_API_KEY / EMAIL_FROM'}`);
    return;
  }
  try {
    await smtpTransport().verify();
    console.log(`[email] provider=smtp connected to ${process.env.SMTP_HOST} as ${process.env.SMTP_USER}`);
  } catch (err) {
    console.error('[email] provider=smtp FAILED to connect/authenticate:', (err as Error).message);
  }
}

// RFC 2606 reserved domains can never receive mail. Outside production we never
// hand them to a real provider (bounces hurt sender reputation); test scripts use them.
function isReservedTestAddress(to: string): boolean {
  const domain = to.split('@')[1]?.toLowerCase() ?? '';
  return /(^|\.)example\.(com|net|org)$/.test(domain) || /\.(test|invalid|example)$/.test(domain);
}

function deliversToConsole(to: string): boolean {
  return (
    emailProvider() === 'console' ||
    (process.env.NODE_ENV !== 'production' && isReservedTestAddress(to))
  );
}

/**
 * True when the code for `to` isn't really emailed (dev console mode or a reserved
 * test address), so auth responses may include it for the app/tests to proceed.
 * Never true in production.
 */
export function exposeDevCode(to: string): boolean {
  return process.env.NODE_ENV !== 'production' && deliversToConsole(to);
}

export async function sendLoginCodeEmail(to: string, code: string): Promise<void> {
  const subject = `${code} is your Ambika Battery sign-in code`;
  const text =
    `Your Ambika Battery verification code is: ${code}\n\n` +
    `It expires in 10 minutes. If you didn't request this, you can ignore this email.`;

  if (deliversToConsole(to)) {
    console.log(`[email:console] to=${to} subject="${subject}"`);
    return;
  }

  const provider = emailProvider();

  if (provider === 'smtp') {
    const from = process.env.EMAIL_FROM || process.env.SMTP_USER!;
    try {
      await smtpTransport().sendMail({ from, to, subject, text, html: codeEmailHtml(code) });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      console.error('[email] smtp send failed:', (err as Error).message);
      throw SEND_FAILED();
    }
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    console.error('[email] EMAIL_PROVIDER=resend but RESEND_API_KEY / EMAIL_FROM not set');
    throw new HttpError(500, 'Email is not configured on the server', 'EMAIL_NOT_CONFIGURED');
  }

  let res: Response;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text, html: codeEmailHtml(code) }),
    });
  } catch (err) {
    console.error('[email] resend request failed:', err);
    throw SEND_FAILED();
  }
  if (!res.ok) {
    console.error('[email] resend rejected:', res.status, await res.text().catch(() => ''));
    throw SEND_FAILED();
  }
}

function codeEmailHtml(code: string): string {
  return `<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px;color:#111">
  <h2 style="margin:0 0 8px">Ambika Battery</h2>
  <p style="margin:0 0 16px;color:#555">Your verification code is:</p>
  <p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:0 0 16px">${code}</p>
  <p style="margin:0;color:#555;font-size:13px">It expires in 10 minutes. If you didn't request this, you can ignore this email.</p>
</div>`;
}
