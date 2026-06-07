/**
 * Test helper: base58btc encoder used to build synthetic did:key values.
 */
export function base58btcEncode(buf: Buffer): string {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const b of buf) n = n * 256n + BigInt(b);
  let out = "";
  while (n > 0n) {
    const rem = Number(n % 58n);
    n = n / 58n;
    out = ALPHABET[rem] + out;
  }
  for (const b of buf) {
    if (b === 0) out = "1" + out;
    else break;
  }
  return out;
}
