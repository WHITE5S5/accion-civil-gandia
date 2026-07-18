// Barrido de sintaxis: extrae el script del componente dc de cada página y lo valida con new Function().
// Uso: node scripts/check_syntax.mjs [archivo1 archivo2 ...]  (sin args: todos los .html de la raíz)
import { readFileSync, readdirSync } from 'node:fs';

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync('.').filter((f) => f.endsWith('.html'));

let bad = 0;
for (const f of files) {
  const html = readFileSync(f, 'utf8');
  const m = html.match(/<script[^>]*data-dc-script[^>]*>([\s\S]*?)<\/script>/) ||
            html.match(/<script(?![^>]*src)[^>]*>([\s\S]*?class\s+\w+\s+extends\s+DCLogic[\s\S]*?)<\/script>/);
  if (!m) continue;
  try { new Function(m[1]); } catch (e) { bad++; console.log(`FAIL ${f}: ${e.message}`); }
}
console.log(bad ? `${bad} archivos con error` : `OK — ${files.length} archivos revisados, 0 errores`);
process.exit(bad ? 1 : 0);
