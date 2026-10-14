import { readdir, mkdir, rename } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const directory = 'test-results';
await mkdir(directory, { recursive: true });
// Preserve prior phase evidence without letting the grader count stale XML twice.
const reportRun = new Date().toISOString().replace(/[:.]/gu, '-');
for (const entry of await readdir(directory, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.xml')) {
    await rename(join(directory, entry.name), join(directory, `${entry.name}.${reportRun}.previous`));
  }
}
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
