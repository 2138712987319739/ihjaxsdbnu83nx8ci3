import nodemailer from 'nodemailer';

import type { AdminInviteMailerConfig } from '../config';

export async function sendAdminInviteEmail(config: AdminInviteMailerConfig, email: string, inviteLink: string): Promise<void> {
  if (!config.enabled || !config.host || !config.user || !config.pass || !config.from) {
    throw new Error('Admin invite SMTP is not configured.');
  }

  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: !config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
    disableFileAccess: true,
    disableUrlAccess: true,
    name: 'fracturemc-friendconnect',
  });

  await transport.sendMail({
    from: {
      name: config.fromName,
      address: config.from,
    },
    to: email,
    replyTo: config.replyTo ?? undefined,
    subject: 'Your Fracture MC admin panel invite',
    text: [
      'You were invited to the Fracture MC FriendConnect admin panel.',
      '',
      'Open this link to set your password and finish your account setup:',
      inviteLink,
      '',
      'If you were not expecting this invite, ignore this email.',
    ].join('\n'),
    html: [
      '<div style="margin:0;background:#060910;color:#f7f9ff;font-family:Arial,sans-serif;padding:32px">',
      '<div style="max-width:560px;margin:0 auto;border:1px solid rgba(151,169,199,.24);background:#0d1421;border-radius:8px;padding:28px">',
      '<p style="margin:0 0 10px;color:#8fb7ff;font-size:12px;letter-spacing:.12em;text-transform:uppercase">Fracture MC</p>',
      '<h1 style="margin:0 0 14px;font-size:24px;line-height:1.2;color:#fff">FriendConnect admin invite</h1>',
      '<p style="margin:0 0 22px;color:#c8d2e5;font-size:15px;line-height:1.55">You were invited to the Fracture MC FriendConnect admin panel. Open the secure setup link below to create your password.</p>',
      `<a href="${escapeHtml(inviteLink)}" style="display:inline-block;background:#2777ff;color:#fff;text-decoration:none;border-radius:6px;padding:11px 16px;font-weight:700">Set up account</a>`,
      '<p style="margin:24px 0 0;color:#7f8ba3;font-size:12px;line-height:1.5">If you were not expecting this invite, ignore this email.</p>',
      '</div>',
      '</div>',
    ].join(''),
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
