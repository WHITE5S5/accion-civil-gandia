// Genera un secreto TOTP para el 2FA del panel /admin.
//   node scripts/gen_totp_secret.mjs            → nuevo secreto + URL otpauth:// (escanéala en Google Authenticator/Authy)
//   node scripts/gen_totp_secret.mjs --test     → valida el algoritmo contra el vector oficial RFC 6238
// Tras generarlo: pega el valor en Netlify como variable de entorno ADMIN_TOTP_SECRET y redeploy.
import { randomBytes } from 'node:crypto';
import { totpAt, verifyTotp } from '../netlify/functions/admin.mjs';

const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
  let bits = 0, val = 0, out = '';
  for (const byte of buf) {
    val = (val << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; out += A[(val >>> bits) & 31]; }
  }
  if (bits > 0) out += A[(val << (5 - bits)) & 31];
  return out;
}

if (process.argv.includes('--test')) {
  // RFC 6238, secreto ASCII "12345678901234567890" = base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ.
  // En T=59s el contador es floor(59/30)=1 y el TOTP de 8 dígitos es 94287082 → 6 dígitos = 287082.
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const { base32Decode } = await import('../netlify/functions/admin.mjs');
  const got = totpAt(base32Decode(secret), 1);
  const ok = got === '287082';
  console.log('RFC6238 vector (T=59s):', got, ok ? 'OK' : 'FAIL (esperado 287082)');
  process.exit(ok ? 0 : 1);
}

const secret = base32Encode(randomBytes(20)); // 160 bits, recomendado por la RFC
const label = encodeURIComponent('Acción Civil · Admin');
const issuer = encodeURIComponent('Accion Civil Gandia');
const url = `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
console.log('\nADMIN_TOTP_SECRET =', secret);
console.log('\notpauth URL (escanéala como QR o pégala manualmente en la app):\n', url);
console.log('\nQR rápido (opcional): https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' + encodeURIComponent(url));
console.log('\nComprobación en vivo — código actual:', totpAt((await import('../netlify/functions/admin.mjs')).base32Decode(secret), Math.floor(Date.now() / 1000 / 30)));
