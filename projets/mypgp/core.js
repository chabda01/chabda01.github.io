/* my_pgp — cœur du calcul (fonctions pures, sans DOM).
   Réécriture en JavaScript du projet C++ G-CNA-500 : mêmes formats, mêmes règles,
   mêmes messages d'erreur que ./my_pgp CRYPTO_SYSTEM MODE [OPTIONS] [key].
   Chargé par la page et par node (tests comparés au vrai binaire). */
(function (root) {
'use strict';

/* Pas de littéraux BigInt (10n) : le fichier reste lisible par un vieux navigateur. */
var HAS_BIGINT = typeof BigInt === 'function';
var B = HAS_BIGINT ? BigInt : function () { throw new Error('BigInt absent'); };
var B0 = HAS_BIGINT ? B(0) : 0, B1 = HAS_BIGINT ? B(1) : 1, B2 = HAS_BIGINT ? B(2) : 2, B8 = HAS_BIGINT ? B(8) : 8;

/* ───────── erreurs : PgpError et std::invalid_argument du C++ ───────── */
function PgpError(message) { this.name = 'PgpError'; this.message = message; }
PgpError.prototype = Object.create(Error.prototype);
function InvalidArgument(message) { this.name = 'InvalidArgument'; this.message = message; }
InvalidArgument.prototype = Object.create(Error.prototype);

/* ───────── ByteUtils.cpp ───────── */
var HEX = '0123456789abcdef';
function hexDigit(c) {
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 97 && c <= 102) return c - 87;
  if (c >= 65 && c <= 70) return c - 55;
  return -1;
}
function hexToBytes(hex) {
  if (hex.length % 2 !== 0) throw new InvalidArgument('hexadecimal string must have an even length');
  var out = new Array(hex.length / 2);
  for (var i = 0; i < hex.length; i += 2) {
    var hi = hexDigit(hex.charCodeAt(i)), lo = hexDigit(hex.charCodeAt(i + 1));
    if (hi < 0 || lo < 0) throw new InvalidArgument('invalid hexadecimal character');
    out[i / 2] = (hi << 4) | lo;
  }
  return out;
}
function bytesToHex(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) s += HEX[bytes[i] >> 4] + HEX[bytes[i] & 15];
  return s;
}
function padZeros(data, blockSize) {
  if (data.length >= blockSize || blockSize === 0) return data;
  var p = data.slice();
  while (p.length < blockSize) p.push(0);
  return p;
}
function splitBlocks(data, blockSize) {
  var blocks = [];
  if (data.length === 0 || blockSize === 0) return blocks;
  for (var o = 0; o < data.length; o += blockSize)
    blocks.push(padZeros(data.slice(o, Math.min(o + blockSize, data.length)), blockSize));
  return blocks;
}

/* ───────── MessageIo.cpp ───────── */
function readMessage(stdin) {
  return stdin.length && stdin[stdin.length - 1] === 10 ? stdin.slice(0, -1) : stdin.slice();
}
function stripTrailingNewlines(bytes) {
  var n = bytes.length;
  while (n > 0 && (bytes[n - 1] === 10 || bytes[n - 1] === 13)) n--;
  return bytes.slice(0, n);
}
function bytesToLatin1(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}
function latin1ToBytes(s) {
  var out = new Array(s.length);
  for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 255;
  return out;
}
function hexToBytesOrThrow(hex, what) {
  try { return hexToBytes(hex); }
  catch (e) {
    if (e instanceof InvalidArgument) throw new PgpError(what + ' must be an even-length hexadecimal string');
    throw e;
  }
}
/* texte JS -> octets UTF-8 (argv et stdin sont des octets pour le programme) */
function utf8Encode(str) {
  var out = [], i, c;
  for (i = 0; i < str.length; i++) {
    c = str.codePointAt(i);
    if (c > 0xffff) i++;
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

/* ═════════ XOR (Xor.cpp) ═════════ */
function reversed(a) { return a.slice().reverse(); }
function xorSameSize(a, b) {
  var r = new Array(a.length);
  for (var i = 0; i < a.length; i++) r[i] = a[i] ^ b[i];
  return r;
}
var XorCipher = {
  name: 'xor',
  blockSize: function (key) { return key.length; },
  cipherBlock: function (plain, key, trace) {
    if (plain.length !== key.length) throw new InvalidArgument('XOR block cipher: message and key must have the same size');
    var rev = reversed(plain), out = xorSameSize(rev, key);
    if (trace) { trace.input = plain; trace.reversed = rev; trace.output = out; }
    return out;
  },
  decipherBlock: function (ciph, key, trace) {
    if (ciph.length !== key.length) throw new InvalidArgument('XOR block decipher: message and key must have the same size');
    var x = xorSameSize(ciph, key), out = reversed(x);
    if (trace) { trace.input = ciph; trace.xored = x; trace.output = out; }
    return out;
  }
};

/* ═════════ AES (aes/*.cpp) ═════════ */
function gf256Multiply(a, b) {
  var product = 0;
  for (var bit = 0; bit < 8; bit++) {
    if (b & 1) product ^= a;
    var overflow = a & 0x80;
    a = (a << 1) & 0xff;
    if (overflow) a ^= 0x1b;
    b >>= 1;
  }
  return product;
}
function gf256Inverse(a) {
  if (a === 0) return 0;
  for (var c = 1; c < 256; c++) if (gf256Multiply(a, c) === 1) return c;
  return 0;
}
function affineTransform(input) {
  var result = 0;
  for (var i = 0; i < 8; i++) {
    var bit = ((input >> i) & 1) ^ ((input >> ((i + 4) % 8)) & 1) ^ ((input >> ((i + 5) % 8)) & 1)
            ^ ((input >> ((i + 6) % 8)) & 1) ^ ((input >> ((i + 7) % 8)) & 1) ^ ((0x63 >> i) & 1);
    result |= bit << i;
  }
  return result;
}
/* La S-box est calculée, comme dans SBox.cpp : inverse dans GF(2^8), puis transformation affine. */
var SBOX = new Array(256), INV_SBOX = new Array(256);
(function () {
  for (var i = 0; i < 256; i++) {
    var s = affineTransform(gf256Inverse(i));
    SBOX[i] = s; INV_SBOX[s] = i;
  }
})();

function aesKeyWordCount(keyBytes) {
  if (keyBytes === 16 || keyBytes === 24 || keyBytes === 32) return keyBytes / 4;
  throw new InvalidArgument('AES: key size must be 16, 24 or 32 bytes');
}
function aesExpandKey(key) {
  var nk = aesKeyWordCount(key.length), nr = nk + 6, total = 4 * (nr + 1);
  var words = new Array(total), i, rc = 1;
  for (i = 0; i < nk; i++) words[i] = [key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]];
  for (i = nk; i < total; i++) {
    var t = words[i - 1];
    if (i % nk === 0) {
      t = [SBOX[t[1]] ^ rc, SBOX[t[2]], SBOX[t[3]], SBOX[t[0]]];
      rc = gf256Multiply(rc, 2);
    } else if (nk > 6 && i % nk === 4) {
      t = [SBOX[t[0]], SBOX[t[1]], SBOX[t[2]], SBOX[t[3]]];
    }
    var p = words[i - nk];
    words[i] = [p[0] ^ t[0], p[1] ^ t[1], p[2] ^ t[2], p[3] ^ t[3]];
  }
  return words;
}
/* L'état est gardé à plat : s[row + 4*col], le même rangement que aesBytesToState. */
function aesSubBytes(s, box) { for (var i = 0; i < 16; i++) s[i] = box[s[i]]; }
function aesShiftRows(s) {
  var t = s.slice();
  for (var row = 1; row < 4; row++)
    for (var col = 0; col < 4; col++) s[row + 4 * col] = t[row + 4 * ((col + row) % 4)];
}
function aesInvShiftRows(s) {
  var t = s.slice();
  for (var row = 1; row < 4; row++)
    for (var col = 0; col < 4; col++) s[row + 4 * ((col + row) % 4)] = t[row + 4 * col];
}
function aesMixColumns(s) {
  for (var c = 0; c < 16; c += 4) {
    var s0 = s[c], s1 = s[c + 1], s2 = s[c + 2], s3 = s[c + 3];
    s[c] = gf256Multiply(s0, 2) ^ gf256Multiply(s1, 3) ^ s2 ^ s3;
    s[c + 1] = s0 ^ gf256Multiply(s1, 2) ^ gf256Multiply(s2, 3) ^ s3;
    s[c + 2] = s0 ^ s1 ^ gf256Multiply(s2, 2) ^ gf256Multiply(s3, 3);
    s[c + 3] = gf256Multiply(s0, 3) ^ s1 ^ s2 ^ gf256Multiply(s3, 2);
  }
}
function aesInvMixColumns(s) {
  for (var c = 0; c < 16; c += 4) {
    var s0 = s[c], s1 = s[c + 1], s2 = s[c + 2], s3 = s[c + 3];
    s[c] = gf256Multiply(s0, 14) ^ gf256Multiply(s1, 11) ^ gf256Multiply(s2, 13) ^ gf256Multiply(s3, 9);
    s[c + 1] = gf256Multiply(s0, 9) ^ gf256Multiply(s1, 14) ^ gf256Multiply(s2, 11) ^ gf256Multiply(s3, 13);
    s[c + 2] = gf256Multiply(s0, 13) ^ gf256Multiply(s1, 9) ^ gf256Multiply(s2, 14) ^ gf256Multiply(s3, 11);
    s[c + 3] = gf256Multiply(s0, 11) ^ gf256Multiply(s1, 13) ^ gf256Multiply(s2, 9) ^ gf256Multiply(s3, 14);
  }
}
function aesAddRoundKey(s, words, round) {
  for (var col = 0; col < 4; col++) {
    var w = words[4 * round + col];
    for (var row = 0; row < 4; row++) s[row + 4 * col] ^= w[row];
  }
}
function roundKeyBytes(words, round) {
  var out = [];
  for (var c = 0; c < 4; c++) out = out.concat(words[4 * round + c]);
  return out;
}
/* steps : si fourni, reçoit {round, op, state} après chaque opération (pour l'affichage). */
function aesEncryptRaw(block, key, steps) {
  var words = aesExpandKey(key), nr = key.length / 4 + 6, s = block.slice();
  function rec(round, op) { if (steps) steps.push({ round: round, op: op, state: s.slice() }); }
  rec(0, 'Entrée');
  aesAddRoundKey(s, words, 0); rec(0, 'AddRoundKey');
  for (var round = 1; round < nr; round++) {
    aesSubBytes(s, SBOX); rec(round, 'SubBytes');
    aesShiftRows(s); rec(round, 'ShiftRows');
    aesMixColumns(s); rec(round, 'MixColumns');
    aesAddRoundKey(s, words, round); rec(round, 'AddRoundKey');
  }
  aesSubBytes(s, SBOX); rec(nr, 'SubBytes');
  aesShiftRows(s); rec(nr, 'ShiftRows');
  aesAddRoundKey(s, words, nr); rec(nr, 'AddRoundKey');
  return s;
}
function aesDecryptRaw(block, key, steps) {
  var words = aesExpandKey(key), nr = key.length / 4 + 6, s = block.slice();
  function rec(round, op) { if (steps) steps.push({ round: round, op: op, state: s.slice() }); }
  rec(nr, 'Entrée');
  aesAddRoundKey(s, words, nr); rec(nr, 'AddRoundKey');
  for (var round = nr - 1; round >= 1; round--) {
    aesInvShiftRows(s); rec(round, 'InvShiftRows');
    aesSubBytes(s, INV_SBOX); rec(round, 'InvSubBytes');
    aesAddRoundKey(s, words, round); rec(round, 'AddRoundKey');
    aesInvMixColumns(s); rec(round, 'InvMixColumns');
  }
  aesInvShiftRows(s); rec(0, 'InvShiftRows');
  aesSubBytes(s, INV_SBOX); rec(0, 'InvSubBytes');
  aesAddRoundKey(s, words, 0); rec(0, 'AddRoundKey');
  return s;
}
/* Convention du sujet : clé et chiffré sont petit-boutistes mot par mot (4 octets). */
function wordReversed(data) {
  var r = new Array(data.length);
  for (var i = 0; i < data.length; i++) r[i] = 0;
  for (var w = 0; w + 4 <= data.length; w += 4) {
    r[w] = data[w + 3]; r[w + 1] = data[w + 2]; r[w + 2] = data[w + 1]; r[w + 3] = data[w];
  }
  return r;
}
var AesCipher = {
  name: 'aes',
  blockSize: function () { return 16; },
  cipherBlock: function (plain, key, trace) {
    if (plain.length !== 16) throw new InvalidArgument('AES block cipher: block must be 16 bytes');
    var internalKey = wordReversed(key), steps = trace ? [] : null;
    var raw = aesEncryptRaw(plain, internalKey, steps), out = wordReversed(raw);
    if (trace) fillAesTrace(trace, plain, internalKey, steps, raw, out);
    return out;
  },
  decipherBlock: function (ciph, key, trace) {
    if (ciph.length !== 16) throw new InvalidArgument('AES block decipher: block must be 16 bytes');
    var internalKey = wordReversed(key), internal = wordReversed(ciph), steps = trace ? [] : null;
    var out = aesDecryptRaw(internal, internalKey, steps);
    if (trace) fillAesTrace(trace, ciph, internalKey, steps, internal, out);
    return out;
  }
};
function fillAesTrace(trace, input, internalKey, steps, raw, out) {
  var words = aesExpandKey(internalKey), nr = internalKey.length / 4 + 6, rk = [];
  for (var r = 0; r <= nr; r++) rk.push(roundKeyBytes(words, r));
  trace.input = input; trace.internalKey = internalKey; trace.rounds = nr;
  trace.roundKeys = rk; trace.steps = steps; trace.raw = raw; trace.output = out;
}

/* ═════════ SymmetricCipher.cpp : mode flux commun à XOR et AES ═════════ */
function checkSymKey(cipher, key) {
  var zeros = [], n = cipher.blockSize(key);
  for (var i = 0; i < n; i++) zeros.push(0);
  cipher.cipherBlock(zeros, key);
}
function streamApply(cipher, fn, data, key, trace) {
  var result = [], blocks = splitBlocks(data, cipher.blockSize(key));
  for (var i = 0; i < blocks.length; i++) {
    var out = cipher[fn](blocks[i], key, i === 0 ? trace : null);
    for (var j = 0; j < out.length; j++) result.push(out[j]);
  }
  if (trace) trace.blockCount = blocks.length;
  return result;
}
function symApply(cipher, decipher, blockMode, data, key, trace) {
  var fn = decipher ? 'decipherBlock' : 'cipherBlock';
  if (trace) {
    trace.kind = cipher.name; trace.decipher = decipher; trace.blockMode = blockMode;
    trace.key = key; trace.dataLength = data.length; trace.blockSize = cipher.blockSize(key);
  }
  if (blockMode) {
    var out = cipher[fn](data, key, trace);
    if (trace) trace.blockCount = 1;
    return out;
  }
  return streamApply(cipher, fn, data, key, trace);
}

/* ═════════ RSA (rsa/Rsa.cpp, BigUint remplacé par BigInt) ═════════ */
function bigFromLEBytes(bytes) {
  var hex = '';
  for (var i = bytes.length - 1; i >= 0; i--) hex += HEX[bytes[i] >> 4] + HEX[bytes[i] & 15];
  return hex ? B('0x' + hex) : B0;
}
function bigFromLEHex(hex) {
  if (hex.length % 2 !== 0) throw new PgpError("hex number '" + hex + "' has an odd length");
  var bytes = new Array(hex.length / 2);
  for (var i = 0; i < hex.length; i += 2) {
    var hi = hexDigit(hex.charCodeAt(i));
    if (hi < 0) throw new PgpError("invalid hex digit '" + hex[i] + "'");
    var lo = hexDigit(hex.charCodeAt(i + 1));
    if (lo < 0) throw new PgpError("invalid hex digit '" + hex[i + 1] + "'");
    bytes[i / 2] = (hi << 4) | lo;
  }
  return bigFromLEBytes(bytes);
}
function bigToLEBytes(n) {
  if (n === B0) return [0];
  var hex = n.toString(16), out = [];
  if (hex.length % 2) hex = '0' + hex;
  for (var i = hex.length - 2; i >= 0; i -= 2) out.push(parseInt(hex.substr(i, 2), 16));
  return out;
}
function bigToLEHex(n) { return bytesToHex(bigToLEBytes(n)); }
function gcd(a, b) { while (b !== B0) { var r = a % b; a = b; b = r; } return a; }
function lcm(a, b) { return (a === B0 || b === B0) ? B0 : (a / gcd(a, b)) * b; }
function modpow(base, exp, mod) {
  if (mod === B0) throw new PgpError('modpow: modulus is zero');
  if (mod === B1) return B0;
  var result = B1;
  base %= mod;
  while (exp > B0) {
    if (exp & B1) result = (result * base) % mod;
    base = (base * base) % mod;
    exp >>= B1;
  }
  return result;
}
function invmod(a, mod) {
  var oldR = mod, r = a % mod, oldT = B0, t = B1;
  while (r !== B0) {
    var q = oldR / r, nr = oldR - q * r, nt = oldT - q * t;
    oldR = r; r = nr; oldT = t; t = nt;
  }
  if (oldR !== B1) throw new PgpError('modular inverse does not exist');
  return ((oldT % mod) + mod) % mod;
}
var FERMAT = [65537, 257, 17, 5, 3];
function rsaSplitKey(key) {
  var pos = key.indexOf('-');
  if (pos < 0) throw new PgpError('rsa: key must be in EXPONENT-MODULUS format');
  return [key.slice(0, pos), key.slice(pos + 1)];
}
function rsaGenerateKeys(pHex, qHex, trace) {
  var P = bigFromLEHex(pHex), Q = bigFromLEHex(qHex);
  var n = P * Q;
  /* BigUint : 0 - 1 donne 0 (aucun bloc à parcourir), on garde ce comportement. */
  var lambda = lcm(P === B0 ? B0 : P - B1, Q === B0 ? B0 : Q - B1);
  var e = null;
  for (var i = 0; i < FERMAT.length; i++) {
    var c = B(FERMAT[i]);
    if (c < lambda && gcd(c, lambda) === B1) { e = c; break; }
  }
  if (e === null) throw new PgpError('rsa: no Fermat prime is coprime with lambda(n) for these primes');
  var d = invmod(e, lambda), nHex = bigToLEHex(n);
  if (trace) { trace.kind = 'rsa-gen'; trace.p = P; trace.q = Q; trace.n = n; trace.lambda = lambda; trace.e = e; trace.d = d; }
  return [bigToLEHex(e) + '-' + nHex, bigToLEHex(d) + '-' + nHex];
}
/* message : octets. Retourne le texte hexa suivi de \n, comme rsaCipher. */
function rsaCipher(key, message, trace) {
  var k = rsaSplitKey(key), e = bigFromLEHex(k[0]), n = bigFromLEHex(k[1]);
  var m = bigFromLEBytes(stripTrailingNewlines(message));
  var c = modpow(m, e, n);
  if (trace) { trace.kind = 'rsa-c'; trace.m = m; trace.e = e; trace.n = n; trace.c = c; trace.wraps = m >= n; }
  return bigToLEHex(c) + '\n';
}
/* message : octets du texte hexa. Retourne les octets du clair suivis de \n, comme rsaDecipher. */
function rsaDecipher(key, message, trace) {
  var k = rsaSplitKey(key), d = bigFromLEHex(k[0]), n = bigFromLEHex(k[1]);
  var c = bigFromLEHex(bytesToLatin1(stripTrailingNewlines(message)));
  var m = modpow(c, d, n);
  if (trace) { trace.kind = 'rsa-d'; trace.c = c; trace.d = d; trace.n = n; trace.m = m; }
  return bigToLEBytes(m).concat([10]);
}
function rsaCheckKey(key) {
  var pos = key.indexOf('-');
  if (pos < 0) throw new PgpError('rsa: key must be in EXPONENT-MODULUS format');
  if (bigFromLEHex(key.slice(0, pos)) === B0 || bigFromLEHex(key.slice(pos + 1)) === B0)
    throw new PgpError('rsa: key exponent and modulus must not be zero');
}

/* ═════════ SHA-256 et HMAC (x25519/Sha256.cpp) ═════════ */
var K256 = (function () {
  var k = [], n = 2;
  function frac(x) { return Math.floor((x - Math.floor(x)) * 4294967296) >>> 0; }
  while (k.length < 64) {
    var prime = true;
    for (var d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
    if (prime) k.push(frac(Math.cbrt(n)));
    n++;
  }
  return k;
})();
function sha256(bytes) {
  var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  var msg = bytes.slice(), bits = bytes.length * 8, i, t;
  msg.push(0x80);
  while (msg.length % 64 !== 56) msg.push(0);
  var hi = Math.floor(bits / 4294967296), lo = bits >>> 0;
  msg.push(hi >>> 24 & 255, hi >>> 16 & 255, hi >>> 8 & 255, hi & 255, lo >>> 24, lo >>> 16 & 255, lo >>> 8 & 255, lo & 255);
  var w = new Array(64);
  for (var off = 0; off < msg.length; off += 64) {
    for (t = 0; t < 16; t++) w[t] = (msg[off + 4 * t] << 24 | msg[off + 4 * t + 1] << 16 | msg[off + 4 * t + 2] << 8 | msg[off + 4 * t + 3]) >>> 0;
    for (t = 16; t < 64; t++) {
      var a15 = w[t - 15], a2 = w[t - 2];
      var s0 = (a15 >>> 7 | a15 << 25) ^ (a15 >>> 18 | a15 << 14) ^ (a15 >>> 3);
      var s1 = (a2 >>> 17 | a2 << 15) ^ (a2 >>> 19 | a2 << 13) ^ (a2 >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (t = 0; t < 64; t++) {
      var S1 = (e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7);
      var ch = (e & f) ^ (~e & g);
      var t1 = (hh + S1 + ch + K256[t] + w[t]) >>> 0;
      var S0 = (a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10);
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  var out = [];
  for (i = 0; i < 8; i++) out.push(h[i] >>> 24, h[i] >>> 16 & 255, h[i] >>> 8 & 255, h[i] & 255);
  return out;
}
function hmacSha256(key, data) {
  var block = key.length > 64 ? sha256(key) : key.slice(), inner = [], outer = [], i;
  while (block.length < 64) block.push(0);
  for (i = 0; i < 64; i++) { inner.push(block[i] ^ 0x36); outer.push(block[i] ^ 0x5c); }
  return sha256(outer.concat(sha256(inner.concat(data))));
}

/* ═════════ X25519 (x25519/X25519.cpp, les 16 limbes remplacés par BigInt) ═════════ */
var P25519 = HAS_BIGINT ? (B1 << B(255)) - B(19) : 0;
var A24 = HAS_BIGINT ? B(121665) : 0;
var MASK255 = HAS_BIGINT ? (B1 << B(255)) - B1 : 0;
function fmod(x) { x %= P25519; return x < B0 ? x + P25519 : x; }
function x25519(scalar, point) {
  if (scalar.length !== 32 || point.length !== 32) throw new PgpError('x25519: scalar and point must be 32 bytes');
  var z = scalar.slice();
  z[31] = (z[31] & 127) | 64;
  z[0] &= 248;
  var x1 = fmod(bigFromLEBytes(point) & MASK255);
  var x2 = B1, z2 = B0, x3 = x1, z3 = B1, swap = 0, t;
  for (var i = 254; i >= 0; i--) {
    var bit = (z[i >> 3] >> (i & 7)) & 1;
    if (swap ^ bit) { t = x2; x2 = x3; x3 = t; t = z2; z2 = z3; z3 = t; }
    swap = bit;
    var A = fmod(x2 + z2), AA = fmod(A * A), Bm = fmod(x2 - z2), BB = fmod(Bm * Bm), E = fmod(AA - BB);
    var C = fmod(x3 + z3), D = fmod(x3 - z3), DA = fmod(D * A), CB = fmod(C * Bm);
    t = fmod(DA + CB); x3 = fmod(t * t);
    t = fmod(DA - CB); z3 = fmod(x1 * fmod(t * t));
    x2 = fmod(AA * BB);
    z2 = fmod(E * fmod(AA + A24 * E));
  }
  if (swap) { t = x2; x2 = x3; x3 = t; t = z2; z2 = z3; z3 = t; }
  var res = fmod(x2 * modpow(z2, P25519 - B2, P25519));
  var out = bigToLEBytes(res);
  while (out.length < 32) out.push(0);
  return out;
}
function x25519ParseKey(hex, what) {
  var key;
  try { key = hexToBytes(hex); }
  catch (e) {
    if (e instanceof InvalidArgument) throw new PgpError('x25519: ' + what + ' must be a hexadecimal string');
    throw e;
  }
  if (key.length !== 32) throw new PgpError('x25519: ' + what + ' must be exactly 32 bytes (64 hex characters)');
  return key;
}
function x25519PublicKey(priv) {
  var base = [9];
  while (base.length < 32) base.push(0);
  return x25519(priv, base);
}
function isAllZero(bytes) { for (var i = 0; i < bytes.length; i++) if (bytes[i]) return false; return true; }
function deriveKey(shared, label, ephemeralPub, recipientPub) {
  return hmacSha256(shared, [label].concat(ephemeralPub, recipientPub));
}
function applyKeystream(data, key) {
  var out = new Array(data.length);
  for (var offset = 0, counter = 0; offset < data.length; offset += 32, counter++) {
    var block = hmacSha256(key, [counter >>> 24 & 255, counter >>> 16 & 255, counter >>> 8 & 255, counter & 255]);
    for (var i = 0; i < 32 && offset + i < data.length; i++) out[offset + i] = data[offset + i] ^ block[i];
  }
  return out;
}
function computeTag(macKey, ephemeralPub, ciphertext) {
  return hmacSha256(macKey, ephemeralPub.concat(ciphertext)).slice(0, 16);
}
function x25519GenerateKeys(seedHex, random, trace) {
  var priv = seedHex === '' ? random(32) : x25519ParseKey(seedHex, 'seed');
  var pub = x25519PublicKey(priv);
  if (trace) { trace.kind = 'x-gen'; trace.priv = priv; trace.pub = pub; trace.random = seedHex === ''; }
  return [bytesToHex(pub), bytesToHex(priv)];
}
function x25519Cipher(publicKeyHex, message, random, trace) {
  var recipientPub = x25519ParseKey(publicKeyHex, 'public key');
  var ephemeral = random(32), ephemeralPub = x25519PublicKey(ephemeral);
  var shared = x25519(ephemeral, recipientPub);
  if (isAllZero(shared)) throw new PgpError('x25519: invalid public key (low-order point)');
  var encKey = deriveKey(shared, 1, ephemeralPub, recipientPub);
  var macKey = deriveKey(shared, 2, ephemeralPub, recipientPub);
  var ciphertext = applyKeystream(message, encKey), tag = computeTag(macKey, ephemeralPub, ciphertext);
  if (trace) {
    trace.kind = 'x-c'; trace.ephemeralPub = ephemeralPub; trace.shared = shared; trace.encKey = encKey;
    trace.macKey = macKey; trace.ciphertext = ciphertext; trace.tag = tag; trace.length = message.length;
  }
  return bytesToHex(ephemeralPub) + ':' + bytesToHex(ciphertext) + ':' + bytesToHex(tag) + '\n';
}
function x25519Decipher(privateKeyHex, text, trace) {
  var priv = x25519ParseKey(privateKeyHex, 'private key');
  var line = bytesToLatin1(stripTrailingNewlines(text));
  var first = line.indexOf(':'), second = first < 0 ? -1 : line.indexOf(':', first + 1);
  if (second < 0 || line.indexOf(':', second + 1) >= 0) throw new PgpError('x25519: ciphertext must be EPHEMERAL:CIPHERTEXT:TAG');
  var ephemeralPub, body, tag;
  try {
    ephemeralPub = hexToBytes(line.slice(0, first));
    body = hexToBytes(line.slice(first + 1, second));
    tag = hexToBytes(line.slice(second + 1));
  } catch (e) {
    if (e instanceof InvalidArgument) throw new PgpError('x25519: ciphertext is not valid hexadecimal');
    throw e;
  }
  if (ephemeralPub.length !== 32 || tag.length !== 16) throw new PgpError('x25519: malformed ciphertext (bad ephemeral key or tag size)');
  var recipientPub = x25519PublicKey(priv), shared = x25519(priv, ephemeralPub);
  if (isAllZero(shared)) throw new PgpError('x25519: invalid ephemeral key (low-order point)');
  var macKey = deriveKey(shared, 2, ephemeralPub, recipientPub);
  var expected = computeTag(macKey, ephemeralPub, body), diff = 0;
  for (var i = 0; i < 16; i++) diff |= expected[i] ^ tag[i];
  if (trace) {
    trace.kind = 'x-d'; trace.ephemeralPub = ephemeralPub; trace.shared = shared; trace.macKey = macKey;
    trace.tag = tag; trace.expectedTag = expected; trace.tagOk = diff === 0; trace.length = body.length;
  }
  if (diff !== 0) throw new PgpError('x25519: authentication failed (wrong key or corrupted message)');
  var encKey = deriveKey(shared, 1, ephemeralPub, recipientPub);
  if (trace) trace.encKey = encKey;
  return applyKeystream(body, encKey);
}

/* ═════════ Cli.cpp ═════════ */
var USAGE =
  'USAGE\n' +
  '      ./my_pgp CRYPTO_SYSTEM MODE [OPTIONS] [key]\n' +
  '\n' +
  'DESCRIPTION\n' +
  'Cipher or decipher MESSAGE using a given CRYPTO_SYSTEM. The MESSAGE is read from the standard input.\n' +
  '\n' +
  '   CRYPTO_SYSTEM\n' +
  '        "xor"            computation using XOR algorithm\n' +
  '        "aes"            computation using AES algorithm\n' +
  '        "rsa"            computation using RSA algorithm\n' +
  '        "X25519"         computation using X25519 (ECIES: Curve25519 Diffie-Hellman + HMAC-SHA256)\n' +
  '        "pgp-xor"        computation using both RSA and XOR algorithm\n' +
  '        "pgp-aes"        computation using both RSA and AES algorithm\n' +
  '\n' +
  '   MODE\n' +
  '        -c               MESSAGE is clear and we want to cipher it\n' +
  '        -d               MESSAGE is ciphered and we want to decipher it\n' +
  "        -g P Q           RSA only: don't read a MESSAGE, but instead generate a public and private key\n" +
  '                         pair from the prime number P and Q\n' +
  '        -g [SEED]        X25519 only: generate a key pair (SEED = optional 32-byte private key)\n' +
  '\n' +
  '   OPTIONS\n' +
  '        -b               for XOR, AES and PGP, only works on one block. The MESSAGE and the symmetric\n' +
  '                         key must be the same size\n' +
  '\n' +
  '   key                    Key used to cipher/decipher MESSAGE (incompatible with -g MODE)\n';

function parseArgs(tokens) {
  if (tokens.length && tokens[0] === '-h') return { help: true };
  if (!tokens.length) throw new PgpError('missing CRYPTO_SYSTEM, try -h for usage');
  if (tokens.length < 2) throw new PgpError('missing MODE, try -h for usage');
  var args = { cryptoSystem: tokens[0], mode: '', blockMode: false, sign: false, key: '', generateArgs: [] };
  var m = tokens[1];
  if (m === '-g') {
    args.mode = 'g';
    if (tokens.length > 4) throw new PgpError('-g accepts at most two arguments');
    args.generateArgs = tokens.slice(2);
    return args;
  }
  if (m === '-c') args.mode = 'c';
  else if (m === '-d') args.mode = 'd';
  else throw new PgpError("invalid MODE '" + m + "', expected -c, -d or -g");
  for (var i = 2; i < tokens.length; i++) {
    var tok = tokens[i];
    if (tok === '-b') args.blockMode = true;
    else if (tok === '-s') args.sign = true;
    else if (tok !== '' && tok[0] === '-') throw new PgpError("unknown option '" + tok + "'");
    else if (args.key === '') args.key = tok;
    else throw new PgpError("unexpected extra argument '" + tok + "'");
  }
  if (args.key === '') throw new PgpError('missing key');
  return args;
}

/* ═════════ les cryptosystèmes (systems/*.cpp, pgpxor, pgpaes) ═════════ */
function runSymmetric(name, cipher, args, stdin, out, trace) {
  if (args.mode === 'g') throw new PgpError(name + ': -g is only available for asymmetric crypto systems');
  if (args.sign) throw new PgpError(name + ': signatures (-s) are not implemented yet (bonus)');
  var key = hexToBytesOrThrow(args.key, 'key');
  checkSymKey(cipher, key);
  var input = readMessage(stdin);
  if (args.mode === 'c') {
    out.push.apply(out, latin1ToBytes(bytesToHex(symApply(cipher, false, args.blockMode, input, key, trace)) + '\n'));
  } else {
    var ciphered = hexToBytesOrThrow(bytesToLatin1(input), 'message');
    out.push.apply(out, symApply(cipher, true, args.blockMode, ciphered, key, trace));
    out.push(10);
  }
}
function runAsymmetric(name, args, stdin, out, trace, random) {
  if (args.sign) throw new PgpError(name + ': signatures (-s) are not implemented yet (bonus)');
  var pair;
  if (args.mode === 'g') {
    if (name === 'rsa') {
      if (args.generateArgs.length !== 2) throw new PgpError('-g requires exactly two arguments: P Q');
      pair = rsaGenerateKeys(args.generateArgs[0], args.generateArgs[1], trace);
    } else {
      if (args.generateArgs.length > 1) throw new PgpError('x25519: -g accepts at most one argument: SEED');
      pair = x25519GenerateKeys(args.generateArgs.length ? args.generateArgs[0] : '', random, trace);
    }
    out.push.apply(out, latin1ToBytes('public key: ' + pair[0] + '\nprivate key: ' + pair[1] + '\n'));
    return;
  }
  if (name === 'rsa') {
    rsaCheckKey(args.key);
    if (args.mode === 'c') out.push.apply(out, latin1ToBytes(rsaCipher(args.key, stdin, trace)));
    else out.push.apply(out, rsaDecipher(args.key, stdin, trace)); /* le \n final est celui de printsTrailingNewline */
  } else {
    x25519ParseKey(args.key, args.mode === 'c' ? 'public key' : 'private key');
    if (args.mode === 'c') out.push.apply(out, latin1ToBytes(x25519Cipher(args.key, stdin, random, trace)));
    else out.push.apply(out, x25519Decipher(args.key, stdin, trace));
  }
}
function runPgp(name, cipher, args, stdin, out, trace) {
  if (args.mode === 'g') throw new PgpError(name + ': -g is not available, generate the keys with rsa');
  if (args.sign) throw new PgpError(name + ': signatures (-s) are not implemented yet (bonus)');
  var pos = args.key.lastIndexOf(':');
  if (pos < 0 || pos === 0 || pos + 1 === args.key.length) throw new PgpError(name + ': key must be in SYMMETRIC_KEY:RSA_KEY format');
  var left = args.key.slice(0, pos), right = args.key.slice(pos + 1);
  var rsaTrace = trace ? {} : null, symTrace = trace ? {} : null, symKey;
  if (trace) { trace.kind = 'pgp'; trace.name = name; trace.decipher = args.mode === 'd'; trace.rsa = rsaTrace; trace.sym = symTrace; }
  if (args.mode === 'c') {
    symKey = hexToBytesOrThrow(left, 'symmetric key');
    checkSymKey(cipher, symKey);
    var cipheredKey = bytesToLatin1(stripTrailingNewlines(latin1ToBytes(rsaCipher(right, symKey, rsaTrace))));
    var message = readMessage(stdin);
    var cm = symApply(cipher, false, args.blockMode, message, symKey, symTrace);
    if (trace) { trace.symKey = symKey; trace.keyLine = cipheredKey; trace.keyBits = symKey.length * 8; }
    out.push.apply(out, latin1ToBytes(cipheredKey + '\n' + bytesToHex(cm) + '\n'));
  } else {
    symKey = stripTrailingNewlines(rsaDecipher(right, latin1ToBytes(left), rsaTrace));
    if (trace) { trace.symKey = symKey; trace.keyLine = left; }
    checkSymKey(cipher, symKey);
    var ciphered = hexToBytesOrThrow(bytesToLatin1(stripTrailingNewlines(stdin)), 'message');
    out.push.apply(out, symApply(cipher, true, args.blockMode, ciphered, symKey, symTrace));
    out.push(10);
  }
}

function defaultRandom(n) {
  var g = (typeof globalThis !== 'undefined' ? globalThis : root).crypto;
  var a = new Uint8Array(n);
  g.getRandomValues(a);
  return Array.prototype.slice.call(a);
}

/* Équivalent de main() : argv sans le nom du programme, stdin en octets.
   Retourne { code, stdout (octets), stderr (texte), trace (étapes internes) }. */
function run(argv, stdin, options) {
  var out = [], trace = {}, random = (options && options.random) || defaultRandom;
  try {
    var args = parseArgs(argv);
    if (args.help) return { code: 0, stdout: latin1ToBytes(USAGE), stderr: '', trace: null };
    var name = args.cryptoSystem.toLowerCase();
    if (name === 'xor') runSymmetric('xor', XorCipher, args, stdin, out, trace);
    else if (name === 'aes') runSymmetric('aes', AesCipher, args, stdin, out, trace);
    else if (name === 'rsa' || name === 'x25519') runAsymmetric(name, args, stdin, out, trace, random);
    else if (name === 'pgp-xor') runPgp('pgp-xor', XorCipher, args, stdin, out, trace);
    else if (name === 'pgp-aes') runPgp('pgp-aes', AesCipher, args, stdin, out, trace);
    else return { code: 84, stdout: [], stderr: "my_pgp: '" + args.cryptoSystem + "' is not implemented yet\n", trace: null };
    return { code: 0, stdout: out, stderr: '', trace: trace };
  } catch (e) {
    if (e instanceof PgpError || e instanceof InvalidArgument)
      return { code: 84, stdout: [], stderr: 'my_pgp: ' + e.message + '\n', trace: trace.kind ? trace : null };
    throw e;
  }
}

/* ───────── ligne de commande équivalente (pour l'affichage) ───────── */
function shellQuote(text) {
  if (!/[\\"$`!]/.test(text)) return '"' + text + '"';
  return "'" + text.replace(/'/g, "'\\''") + "'";
}
function shellArg(a) { return /^[A-Za-z0-9_:.\/-]+$/.test(a) ? a : shellQuote(a); }
/* stdinText : le texte passé à echo (echo ajoute le \n final), ou null s'il n'y a pas d'entrée. */
function commandLine(argv, stdinText) {
  var cmd = './my_pgp ' + argv.map(shellArg).join(' ');
  return stdinText === null || stdinText === undefined ? cmd : 'echo ' + shellQuote(stdinText) + ' | ' + cmd;
}

/* ───────── confort web : nombres premiers au hasard (Miller-Rabin), absent du programme principal ───────── */
var SMALL_PRIMES = [3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97];
function isProbablePrime(n, random) {
  if (n < B2) return false;
  if (n === B2) return true;
  if (!(n & B1)) return false;
  for (var i = 0; i < SMALL_PRIMES.length; i++) {
    var sp = B(SMALL_PRIMES[i]);
    if (n === sp) return true;
    if (n % sp === B0) return false;
  }
  var d = n - B1, r = 0;
  while (!(d & B1)) { d >>= B1; r++; }
  var len = bigToLEBytes(n).length;
  for (var round = 0; round < 24; round++) {
    var a = bigFromLEBytes(random(len)) % (n - B(3)) + B2;
    var x = modpow(a, d, n);
    if (x === B1 || x === n - B1) continue;
    var composite = true;
    for (var j = 1; j < r; j++) {
      x = (x * x) % n;
      if (x === n - B1) { composite = false; break; }
    }
    if (composite) return false;
  }
  return true;
}
/* Un premier de `bits` bits (multiple de 8), rendu en hexa petit-boutiste comme l'attend -g P Q. */
function randomPrimeHex(bits, random) {
  random = random || defaultRandom;
  var n = bits / 8;
  for (;;) {
    var b = random(n);
    b[0] |= 1;
    b[n - 1] |= 0xc0;
    if (isProbablePrime(bigFromLEBytes(b), random)) return bytesToHex(b);
  }
}

var api = {
  HAS_BIGINT: HAS_BIGINT, USAGE: USAGE,
  run: run, parseArgs: parseArgs, commandLine: commandLine,
  hexToBytes: hexToBytes, bytesToHex: bytesToHex, utf8Encode: utf8Encode, splitBlocks: splitBlocks,
  XorCipher: XorCipher, AesCipher: AesCipher, aesEncryptRaw: aesEncryptRaw, aesDecryptRaw: aesDecryptRaw,
  aesExpandKey: aesExpandKey, wordReversed: wordReversed, SBOX: SBOX, INV_SBOX: INV_SBOX, gf256Multiply: gf256Multiply,
  rsaGenerateKeys: rsaGenerateKeys, rsaCipher: rsaCipher, rsaDecipher: rsaDecipher,
  bigFromLEHex: bigFromLEHex, bigToLEHex: bigToLEHex, modpow: modpow,
  sha256: sha256, hmacSha256: hmacSha256, x25519: x25519, x25519PublicKey: x25519PublicKey,
  randomBytes: defaultRandom, randomPrimeHex: randomPrimeHex, isProbablePrime: isProbablePrime,
  PgpError: PgpError
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.PGP = api;
})(typeof self !== 'undefined' ? self : this);
