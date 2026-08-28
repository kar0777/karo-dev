import postgres from 'postgres';
import { readFileSync } from 'node:fs';
const url = readFileSync('.env.local', 'utf8')
  .match(/^DATABASE_URL=(.*)$/m)[1]
  .trim();
const sql = postgres(url, { max: 1 });
try {
  for (const q of process.argv.slice(2)) {
    console.log('### ' + q);
    console.log(JSON.stringify(await sql.unsafe(q), null, 1));
  }
} finally {
  await sql.end();
}
