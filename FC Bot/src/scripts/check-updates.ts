import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

async function main(): Promise<void> {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as PackageJson;
  const dependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };

  const names = Object.keys(dependencies).sort();
  for (const name of names) {
    const current = dependencies[name];
    if (!current) {
      continue;
    }

    try {
      const latest = await getLatestVersion(name);
      const normalized = current.replace(/^[~^]/, '');
      const status = normalized === latest ? 'current' : 'review';
      console.log(`${status} ${name}: installed ${normalized}, latest ${latest}`);
    } catch (error) {
      console.log(`error ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
async function getLatestVersion(name: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('npm', ['view', name, 'version', '--json'], {
      timeout: 30000,
    });

    const parsed = JSON.parse(stdout.trim()) as string;
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to fetch version: ${message}`, { cause: error });
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
