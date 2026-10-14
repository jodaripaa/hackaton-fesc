import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readMigrations } from '../../src/persistence/migrations.ts';

test('migraciones_ordenan_y_normalizan_saltos_para_checksum', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'caja-link-migrations-'));
  try {
    await writeFile(join(directory, '002_second.sql'), 'SELECT 2;\n');
    await writeFile(join(directory, '001_first.sql'), 'SELECT 1;\r\n');
    const first = await readMigrations(directory);
    assert.deepEqual(first.map(item => item.name), ['001_first.sql', '002_second.sql']);
    await writeFile(join(directory, '001_first.sql'), 'SELECT 1;\n');
    assert.equal((await readMigrations(directory))[0]?.checksum, first[0]?.checksum);
    await writeFile(join(directory, '001_first.sql'), 'SELECT 100;\n');
    assert.notEqual((await readMigrations(directory))[0]?.checksum, first[0]?.checksum);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('migraciones_rechazan_prefijos_duplicados_y_nombres_invalidos', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'caja-link-migrations-'));
  try {
    await assert.rejects(readMigrations(directory));
    await writeFile(join(directory, '001_first.sql'), 'SELECT 1;');
    await writeFile(join(directory, '001_duplicate.sql'), 'SELECT 1;');
    await assert.rejects(readMigrations(directory));
    await rm(join(directory, '001_duplicate.sql'));
    await writeFile(join(directory, 'not-versioned.sql'), 'SELECT 1;');
    await assert.rejects(readMigrations(directory));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
