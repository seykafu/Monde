// npx tsx tools/export-telemetry.ts [output-directory]
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDatabase } from '../server/src/db/client.js';
import { exportTelemetry } from '../server/src/telemetry/export.js';
const database = createDatabase(process.env.DATABASE_URL);
if (!database) throw new Error('DATABASE_URL is required');
try {
  const result = await exportTelemetry(database.db);
  const directory = resolve(process.argv[2] ?? 'telemetry-export');
  await mkdir(directory,{ recursive: true, mode: 0o700 });
  await Promise.all([
    writeFile(resolve(directory,'events.csv'),result.eventsCsv,{ mode: 0o600 }),
    writeFile(resolve(directory,'survey-answers.csv'),result.surveysCsv,{ mode: 0o600 }),
    writeFile(resolve(directory,'summary.json'),JSON.stringify(result.summary,null,2)+'\n',{ mode: 0o600 }),
  ]);
  console.log(`Telemetry exported to ${directory}`);
} finally { await database.client.end(); }
