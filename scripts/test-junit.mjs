import { readdir, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const directory = 'test-results';
await mkdir(directory, { recursive: true });
const files = [];
for (const suite of ['unit', 'integration']) {
  for (const file of (await readdir(join('tests', suite))).sort()) {
    if (file.endsWith('.test.ts') || file.endsWith('.test.mjs')) files.push(join('tests', suite, file));
  }
}
const child = spawn(process.execPath, [
  '--test', '--test-reporter=spec', '--test-reporter-destination=stdout',
  '--test-reporter=junit', `--test-reporter-destination=${join(directory, 'junit.xml')}`, ...files,
], { stdio: 'inherit', env: process.env });
child.once('error', () => { process.stderr.write('No se pudo iniciar el runner de pruebas.\n'); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
