import { lookup } from 'node:dns/promises';
import { existsSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

import { loadConfig, loadEnvFile } from '../config';

type Check = {
  name: string;
  ok: boolean;
  detail: string;
};

async function main(): Promise<void> {
  loadEnvFile();
  const config = loadConfig();

  const checks: Check[] = [];

  checks.push({
    name: 'node',
    ok: isSupportedNode(process.versions.node),
    detail: `running ${process.versions.node}`,
  });

  checks.push({
    name: 'target',
    ok: true,
    detail: `${config.bedrockHost}:${config.bedrockPort}`,
  });

  checks.push({
    name: 'auth-cache-parent',
    ok: canCreateUnder(dirname(config.authCacheDir)),
    detail: `${dirname(config.authCacheDir)} will be created at runtime if missing`,
  });

  checks.push(await checkDns(config.bedrockHost));

  if (config.admin.enabled) {
    checks.push({
      name: 'admin-bridge',
      ok: Boolean(config.admin.supabaseUrl && config.admin.serviceRoleKey),
      detail: `bot id ${config.admin.botId}`,
    });

    checks.push({
      name: 'admin-invite-mailer',
      ok: config.admin.inviteMailer.enabled,
      detail: config.admin.inviteMailer.enabled
        ? `${config.admin.inviteMailer.host}:${config.admin.inviteMailer.port}`
        : 'SMTP fallback disabled; Supabase Auth email quota applies',
    });
  }

  for (const check of checks) {
    const status = check.ok ? 'ok' : 'warn';
    console.log(`${status} ${check.name}: ${check.detail}`);
  }

  const requiredFailures = checks.filter((check) => !check.ok && !['dns', 'admin-invite-mailer'].includes(check.name));
  if (requiredFailures.length > 0) {
    process.exitCode = 1;
  }
}

function isSupportedNode(version: string): boolean {
  const [major = '0', minor = '0'] = version.split('.');
  const majorNumber = Number(major);
  const minorNumber = Number(minor);

  return majorNumber > 20 || (majorNumber === 20 && minorNumber >= 18);
}

function directoryExists(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

function canCreateUnder(path: string): boolean {
  if (directoryExists(path)) {
    return true;
  }

  const parent = dirname(path);
  if (parent === path) {
    return false;
  }

  return canCreateUnder(parent);
}

async function checkDns(host: string): Promise<Check> {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host === 'localhost') {
    return {
      name: 'dns',
      ok: true,
      detail: 'not required for literal host',
    };
  }

  try {
    const result = await lookup(host);
    return {
      name: 'dns',
      ok: true,
      detail: `${host} resolves to ${result.address}`,
    };
  } catch {
    return {
      name: 'dns',
      ok: false,
      detail: `${host} did not resolve from this machine`,
    };
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
