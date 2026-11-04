// Lokal ishga tushirish (Postgres o'rnatmasdan): PGlite bazasi + server.
// Biri to'xtasa yoki qotsa (server nazoratchisi o'zi chiqib ketadi) — 2 soniyadan keyin ikkalasi qayta ko'tariladi.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const pglite = fileURLToPath(new URL('./node_modules/@electric-sql/pglite-socket/dist/scripts/server.js', import.meta.url));

function start() {
  const child = spawn(process.execPath, [pglite, '--db=./.pgdata', '--port=5433', '--max-connections=4',
    '--run=node --env-file-if-exists=.env server.js'], { stdio: 'inherit' });
  child.on('exit', (code) => {
    console.log(`Baza/server to'xtadi (kod ${code}), 2 soniyadan keyin qayta ishga tushiriladi`);
    setTimeout(start, 2000);
  });
}
start();
