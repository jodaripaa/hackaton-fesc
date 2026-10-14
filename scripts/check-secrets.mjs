import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

process.loadEnvFile('.env');
const names = ['NORTE_TOKEN', 'ORIENTE_TOKEN', 'CENTRO_TOKEN', 'SUR_TOKEN', 'ADMIN_TOKEN',
  'CAJA_NORTE_API_KEY', 'CAJA_ORIENTE_PASSWORD', 'CAJA_SUR_TOKEN', 'PGPASSWORD'];
const values = [...new Set(names.map(name => process.env[name]).filter(value => value && !value.startsWith('cambiar-')))];
const git = args => spawnSync('git', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true });
const revisions = git(['rev-list', '--all']);
if (revisions.status !== 0) throw new Error('Cannot inspect Git history');
const commits = revisions.stdout.trim().split(/\s+/u).filter(Boolean);
const matches = [];
if (values.length) {
  for (const revision of [...commits, undefined]) {
    const args = ['grep', '-I', '-l', '-F', '-f', '-', ...(revision ? [revision] : [])];
    // Patterns travel through stdin, never command arguments or evidence output.
    const result = spawnSync('git', args, { input: `${values.join('\n')}\n`, encoding: 'utf8', windowsHide: true });
    if (result.status === 0) matches.push(...result.stdout.trim().split(/\r?\n/u));
    else if (result.status !== 1) throw new Error('Cannot complete secret comparison');
  }
}
const evidence = { checkedAt: new Date().toISOString(), commitsChecked: commits.length,
  currentTrackedFilesChecked: true, actualCredentialValuesCompared: values.length,
  matches: [...new Set(matches)], passed: matches.length === 0 };
await mkdir('test-results', { recursive: true });
await writeFile('test-results/secrets-check.json', `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence));
if (!evidence.passed) process.exitCode = 1;
