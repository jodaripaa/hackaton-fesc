import { cp } from 'node:fs/promises';

await cp('src/persistence/migrations', 'dist/persistence/migrations', { recursive: true });
