/* Stone Analysis — cœur du calcul.
   Réécriture en JavaScript du projet d'origine en C (wav.c, fft.c, analyze.c,
   cypher.c, decypher.c). Fonctions pures : aucune ne touche à la page.
   Marche dans le navigateur (window.StoneCore) et sous node (require). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StoneCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ───────────── WAV (wav.c) ───────────── */

  function tag(b, o) {
    return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  }
  function le16(b, o) { return b[o] | (b[o + 1] << 8); }
  function le32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

  // En-tête WAV minimal de 44 octets (PCM, mono, 16 bits).
  function wavHeader(sampleRate, numSamples) {
    var h = new Uint8Array(44), v = new DataView(h.buffer), i;
    var txt = function (o, s) { for (i = 0; i < 4; i++) h[o + i] = s.charCodeAt(i); };
    txt(0, 'RIFF'); v.setUint32(4, 36 + numSamples * 2, true); txt(8, 'WAVE');
    txt(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, 1, true); v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true);
    v.setUint16(34, 16, true); txt(36, 'data'); v.setUint32(40, numSamples * 2, true);
    return h;
  }

  /* Lecture d'un WAV. Mêmes étapes et mêmes messages que wav_read().
     strict = true  : comme le C, on n'accepte que PCM mono 48 000 Hz 16 bits.
     strict = false : confort web, on accepte aussi d'autres fréquences
                      d'échantillonnage et la stéréo (moyenne des canaux). */
  function wavRead(buffer, opts) {
    var strict = !opts || opts.strict !== false;
    var name = (opts && opts.name) || 'fichier';
    var b = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (b.length < 12 || tag(b, 0) !== 'RIFF' || tag(b, 8) !== 'WAVE')
      throw new Error(name + ': not a valid WAVE file');
    var pos = 12, fmtOk = false, dataOffset = -1, dataSize = 0;
    var channels = 0, rate = 0, bits = 0;
    while (pos + 8 <= b.length) {
      var id = tag(b, pos), sz = le32(b, pos + 4);
      pos += 8;
      if (id === 'fmt ') {
        if (sz < 16) throw new Error(name + ': malformed fmt chunk');
        if (pos + 16 > b.length) throw new Error(name + ': missing fmt or data chunk');
        var audioFmt = le16(b, pos);
        channels = le16(b, pos + 2);
        rate = le32(b, pos + 4);
        bits = le16(b, pos + 14);
        if (audioFmt !== 1) throw new Error(name + ': unsupported audio format (not PCM)');
        if (strict ? channels !== 1 : channels < 1) throw new Error(name + ': only mono is supported');
        if (strict ? rate !== 48000 : rate < 1) throw new Error(name + ': unsupported sample rate ' + rate);
        if (bits !== 16) throw new Error(name + ': unsupported bit depth ' + bits);
        pos += sz;
        fmtOk = true;
      } else if (id === 'data') {
        dataOffset = pos; dataSize = sz;
        break;
      } else {
        pos += sz + (sz & 1);
      }
    }
    if (!fmtOk || dataOffset < 0) throw new Error(name + ': missing fmt or data chunk');
    if (dataSize === 0) throw new Error(name + ': empty audio data');
    var avail = b.length - dataOffset;
    if (dataSize > avail) {
      if (strict) throw new Error(name + ': truncated audio data');
      dataSize = avail;
    }
    var total = Math.floor(dataSize / 2);
    var raw = new Int16Array(total), i, p = dataOffset;
    for (i = 0; i < total; i++, p += 2) raw[i] = (b[p] | (b[p + 1] << 8)) << 16 >> 16;
    var samples = raw, rawHeader = b.slice(0, dataOffset), mixed = false;
    if (channels > 1) {
      var frames = Math.floor(total / channels), c, sum;
      samples = new Int16Array(frames);
      for (i = 0; i < frames; i++) {
        sum = 0;
        for (c = 0; c < channels; c++) sum += raw[i * channels + c];
        samples[i] = Math.round(sum / channels);
      }
      rawHeader = wavHeader(rate, frames);
      mixed = true;
    }
    return {
      rawHeader: rawHeader, headerSize: rawHeader.length, sampleRate: rate,
      bitsPerSample: bits, numChannels: channels, samples: samples,
      numSamples: samples.length, mixedDown: mixed
    };
  }

  // Comme wav_write() : l'en-tête d'origine tel quel, puis les échantillons.
  function wavWrite(wav) {
    var h = wav.rawHeader, s = wav.samples, n = s.length;
    var out = new Uint8Array(h.length + n * 2), p = h.length, i;
    out.set(h, 0);
    for (i = 0; i < n; i++, p += 2) {
      out[p] = s[i] & 0xFF;
      out[p + 1] = (s[i] >> 8) & 0xFF;
    }
    return out;
  }

  function makeWav(samples, sampleRate) {
    return {
      rawHeader: wavHeader(sampleRate, samples.length), headerSize: 44,
      sampleRate: sampleRate, bitsPerSample: 16, numChannels: 1,
      samples: samples, numSamples: samples.length, mixedDown: false
    };
  }

  /* ───────────── FFT (fft.c) ───────────── */

  function nextPow2(n) { var p = 1; while (p < n) p *= 2; return p; }
  function isPow2(n) { return n > 0 && (n & (n - 1)) === 0; }

  // Permutation par inversion des bits de l'indice.
  function bitReversal(re, im, n) {
    var i, j = 0, bit, t;
    for (i = 1; i < n; i++) {
      bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
  }

  // Les « papillons » : groupes de 2, puis 4, puis 8… jusqu'à n.
  function butterflyPass(re, im, n, inverse) {
    var len, half, ang, wlr, wli, i, j, wr, wi, a, c, ur, ui, vr, vi, t;
    for (len = 2; len <= n; len <<= 1) {
      ang = 2.0 * Math.PI / len * (inverse ? 1.0 : -1.0);
      wlr = Math.cos(ang); wli = Math.sin(ang);
      half = len >> 1;
      for (i = 0; i < n; i += len) {
        wr = 1.0; wi = 0.0;
        for (j = 0; j < half; j++) {
          a = i + j; c = a + half;
          ur = re[a]; ui = im[a];
          vr = re[c] * wr - im[c] * wi;
          vi = re[c] * wi + im[c] * wr;
          re[a] = ur + vr; im[a] = ui + vi;
          re[c] = ur - vr; im[c] = ui - vi;
          t = wr * wlr - wi * wli;
          wi = wr * wli + wi * wlr;
          wr = t;
        }
      }
    }
  }

  function fftImpl(re, im, inverse) {
    var n = re.length, i, inv;
    if (n <= 1) return;
    if (!isPow2(n)) throw new Error('fft: la taille doit être une puissance de 2');
    bitReversal(re, im, n);
    butterflyPass(re, im, n, inverse);
    if (inverse) {
      inv = 1.0 / n;
      for (i = 0; i < n; i++) { re[i] *= inv; im[i] *= inv; }
    }
  }
  // FFT de Cooley-Tukey, sur place. re et im : deux Float64Array de même taille.
  function fft(re, im) { fftImpl(re, im, false); }
  function ifft(re, im) { fftImpl(re, im, true); }

  // DFT naïve : pour chaque fréquence k, on relit tous les points. O(n²).
  // Calcule les cases k0 à k1 - 1 (pour pouvoir avancer par morceaux).
  function dftMagnitudeRange(samples, n, mag, k0, k1) {
    var k, j, re, im, factor, angle;
    for (k = k0; k < k1; k++) {
      re = 0.0; im = 0.0;
      factor = -2.0 * Math.PI * k / n;
      for (j = 0; j < n; j++) {
        angle = factor * j;
        re += samples[j] * Math.cos(angle);
        im += samples[j] * Math.sin(angle);
      }
      mag[k] = Math.sqrt(re * re + im * im);
    }
  }
  function dftMagnitude(samples, n) {
    var mag = new Float64Array(n);
    dftMagnitudeRange(samples, n, mag, 0, n);
    return mag;
  }

  // Amplitudes par FFT : on complète avec des zéros jusqu'à la puissance de 2.
  function fftMagnitude(samples, n, size) {
    var re = new Float64Array(size), im = new Float64Array(size), i;
    var mag = new Float64Array(size);
    for (i = 0; i < n; i++) re[i] = samples[i];
    fft(re, im);
    for (i = 0; i < size; i++) mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
    return mag;
  }

  /* ───────────── analyse (analyze.c) ───────────── */

  var DFT_THRESHOLD = 8192;

  // Jusqu'à 8192 points : DFT naïve. Au-delà : FFT.
  function spectrum(samples) {
    var ns = samples.length;
    if (ns <= DFT_THRESHOLD)
      return { magnitudes: dftMagnitude(samples, ns), fftSize: ns, method: 'dft' };
    var size = nextPow2(ns);
    return { magnitudes: fftMagnitude(samples, ns, size), fftSize: size, method: 'fft' };
  }

  /* Les n cases les plus fortes, de la plus forte à la plus faible.
     On saute la case 0 (la moyenne) et on garde les cases 1 à fftSize/2.
     Le C écrit 48000.0 en dur ; ici on prend la vraie fréquence du fichier. */
  function topFrequencies(magnitudes, fftSize, n, sampleRate) {
    var numBins = Math.floor(fftSize / 2);
    if (numBins === 0) throw new Error('Not enough samples to analyze.');
    var k = Math.min(n, numBins), idx = [], i, j, m;
    for (i = 1; i <= numBins; i++) {
      m = magnitudes[i];
      if (idx.length === k && !(m > magnitudes[idx[k - 1]])) continue;
      j = idx.length < k ? idx.length : k - 1;
      while (j > 0 && m > magnitudes[idx[j - 1]]) { idx[j] = idx[j - 1]; j--; }
      idx[j] = i;
    }
    return idx.map(function (b) {
      return { bin: b, freq: b * sampleRate / fftSize, magnitude: magnitudes[b] };
    });
  }

  // Comme printf("%.1f") : arrondi au plus proche, moitié vers le pair.
  function fmt1(x) {
    var t = x * 10, f = Math.floor(t), d = t - f;
    if (d > 0.5 || (d === 0.5 && f % 2 !== 0)) f += 1;
    return Math.floor(f / 10) + '.' + (f % 10);
  }

  // La sortie exacte du programme.
  function formatAnalyze(n, entries) {
    var out = 'Top ' + n + ' frequencies:\n', i;
    for (i = 0; i < entries.length; i++) out += fmt1(entries[i].freq) + ' Hz\n';
    return out;
  }

  /* ───────────── message caché (cypher.c, decypher.c) ───────────── */

  var FRAME_SIZE = 4096, BASE_BIN = 1540, ENCODE_AMP = 100000.0, DETECT_THRESHOLD = 50000.0;
  var IDX_START = 37, IDX_END = 38;

  function charToIdx(ch) {
    var c = ch.charCodeAt(0);
    if (c >= 97 && c <= 122) return c - 97;
    if (c >= 65 && c <= 90) return c - 65;
    if (c >= 48 && c <= 57) return 26 + c - 48;
    if (c === 32) return 36;
    return -1;
  }
  function idxToChar(idx) {
    if (idx >= 0 && idx <= 25) return String.fromCharCode(65 + idx);
    if (idx >= 26 && idx <= 35) return String.fromCharCode(48 + idx - 26);
    if (idx === 36) return ' ';
    return '';
  }

  // Une trame de 4096 points : FFT, on pousse une case, FFT inverse.
  function encodeFrame(samples, offset, charIdx) {
    var re = new Float64Array(FRAME_SIZE), im = new Float64Array(FRAME_SIZE), i, v, bin;
    for (i = 0; i < FRAME_SIZE; i++) re[i] = samples[offset + i];
    fft(re, im);
    bin = BASE_BIN + charIdx;
    re[bin] += ENCODE_AMP;
    re[FRAME_SIZE - bin] += ENCODE_AMP;
    ifft(re, im);
    for (i = 0; i < FRAME_SIZE; i++) {
      v = re[i];
      if (v > 32767.0) v = 32767.0;
      if (v < -32768.0) v = -32768.0;
      samples[offset + i] = Math.trunc(v);
    }
  }

  // Renvoie une copie des échantillons avec le message caché dedans.
  function cypher(samples, message) {
    var len = message.length, i;
    for (i = 0; i < len; i++)
      if (charToIdx(message[i]) < 0) throw new Error("Unsupported character: '" + message[i] + "'");
    var needed = len + 2, avail = Math.floor(samples.length / FRAME_SIZE);
    if (avail < needed)
      throw new Error('Audio file too short (' + avail + ' frames, ' + needed + ' needed)');
    var out = new Int16Array(samples);
    encodeFrame(out, 0, IDX_START);
    for (i = 0; i < len; i++) encodeFrame(out, (i + 1) * FRAME_SIZE, charToIdx(message[i]));
    encodeFrame(out, (len + 1) * FRAME_SIZE, IDX_END);
    return out;
  }

  // Les 39 cases surveillées d'une trame, et celle qui dépasse le seuil.
  function scanFrame(samples, offset) {
    var re = new Float64Array(FRAME_SIZE), im = new Float64Array(FRAME_SIZE), i;
    var mags = new Float64Array(39), best = -1, bestMag = DETECT_THRESHOLD, m;
    for (i = 0; i < FRAME_SIZE; i++) re[i] = samples[offset + i];
    fft(re, im);
    for (i = 0; i <= 38; i++) {
      m = Math.sqrt(re[BASE_BIN + i] * re[BASE_BIN + i] + im[BASE_BIN + i] * im[BASE_BIN + i]);
      mags[i] = m;
      if (m > bestMag) { bestMag = m; best = i; }
    }
    return { idx: best, mags: mags };
  }

  // Renvoie le message, ou null (« No hidden message found »).
  function decypher(samples, maxFramesKept) {
    var numFrames = Math.floor(samples.length / FRAME_SIZE);
    var f, r, msg = '', inMessage = false, frames = [], done = false, result = null;
    var keep = maxFramesKept || 0;
    for (f = 0; f < numFrames; f++) {
      if (done && frames.length >= keep) break;
      r = scanFrame(samples, f * FRAME_SIZE);
      if (frames.length < keep) frames.push(r);
      if (done) continue;
      if (r.idx === IDX_START) { inMessage = true; msg = ''; }
      else if (r.idx === IDX_END && inMessage) { result = msg; done = true; }
      else if (r.idx >= 0 && inMessage) msg += idxToChar(r.idx);
    }
    if (!done) result = inMessage ? msg : '';
    return { message: result.length ? result : null, frames: frames, numFrames: numFrames };
  }

  /* ───────────── usage de la FFT inverse : retirer des fréquences ─────────────
     Ajout de la version web. FFT du signal entier, mise à zéro des cases
     autour de chaque fréquence (et de leur miroir), FFT inverse. */
  function removeFrequencies(samples, sampleRate, freqs, halfWidthHz) {
    var ns = samples.length, size = nextPow2(ns);
    var re = new Float64Array(size), im = new Float64Array(size), i, f, lo, hi, k, v, cut = 0;
    for (i = 0; i < ns; i++) re[i] = samples[i];
    fft(re, im);
    for (f = 0; f < freqs.length; f++) {
      lo = Math.max(1, Math.floor((freqs[f] - halfWidthHz) * size / sampleRate));
      hi = Math.min(size / 2, Math.ceil((freqs[f] + halfWidthHz) * size / sampleRate));
      for (k = lo; k <= hi; k++) {
        re[k] = 0; im[k] = 0;
        re[size - k] = 0; im[size - k] = 0;
        cut++;
      }
    }
    var mag = new Float64Array(size);
    for (i = 0; i < size; i++) mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
    ifft(re, im);
    var out = new Int16Array(ns);
    for (i = 0; i < ns; i++) {
      v = re[i];
      if (v > 32767.0) v = 32767.0;
      if (v < -32768.0) v = -32768.0;
      out[i] = Math.trunc(v);
    }
    return { samples: out, magnitudes: mag, fftSize: size, binsCut: cut };
  }

  /* ───────────── lecture du spectre (ajouts web) ───────────── */

  // Les pics : maxima locaux, écartés d'au moins minSepHz.
  function findPeaks(magnitudes, fftSize, sampleRate, count, minSepHz, fromHz, toHz) {
    var half = Math.floor(fftSize / 2);
    var lo = Math.max(1, Math.floor((fromHz || 0) * fftSize / sampleRate));
    var hi = Math.min(half, Math.ceil((toHz || sampleRate / 2) * fftSize / sampleRate));
    var sep = Math.max(1, Math.round(minSepHz * fftSize / sampleRate));
    var peaks = [], used = [], i, k, best, bm, ok, top = 0;
    for (k = lo; k <= hi; k++) if (magnitudes[k] > top) top = magnitudes[k];
    while (peaks.length < count) {
      best = -1; bm = top * 0.04;
      for (k = lo; k <= hi; k++) {
        if (magnitudes[k] <= bm) continue;
        ok = true;
        for (i = 0; i < used.length; i++) if (Math.abs(used[i] - k) < sep) { ok = false; break; }
        if (ok) { bm = magnitudes[k]; best = k; }
      }
      if (best < 0) break;
      used.push(best);
      peaks.push({ bin: best, freq: best * sampleRate / fftSize, magnitude: magnitudes[best] });
    }
    return peaks;
  }

  var DTMF_LOW = [697, 770, 852, 941], DTMF_HIGH = [1209, 1336, 1477, 1633];
  var DTMF_KEYS = ['123A', '456B', '789C', '*0#D'];

  // Retrouve la touche : la fréquence la plus forte de chaque groupe.
  function dtmfDetect(magnitudes, fftSize, sampleRate) {
    function level(f) {
      var k = Math.round(f * fftSize / sampleRate), m = 0, i;
      for (i = k - 1; i <= k + 1; i++) if (i > 0 && i <= fftSize / 2 && magnitudes[i] > m) m = magnitudes[i];
      return m;
    }
    function pick(list) {
      var lv = list.map(level), best = 0, second = 0, i;
      for (i = 1; i < 4; i++) if (lv[i] > lv[best]) best = i;
      for (i = 0; i < 4; i++) if (i !== best && lv[i] > second) second = lv[i];
      return { i: best, sure: lv[best] > 0 && lv[best] >= 3 * second };
    }
    var lo = pick(DTMF_LOW), hi = pick(DTMF_HIGH);
    if (!lo.sure || !hi.sure) return null;
    return { key: DTMF_KEYS[lo.i][hi.i], low: DTMF_LOW[lo.i], high: DTMF_HIGH[hi.i] };
  }

  // Compare un spectre à une référence, par bandes. Renvoie la bande la plus anormale.
  function compareToReference(mag, ref, fftSize, sampleRate, bandHz) {
    var half = Math.floor(fftSize / 2), per = Math.max(1, Math.round(bandHz * fftSize / sampleRate));
    var best = null, k, e, er, end, i, ratio, pk;
    for (k = 1; k + per <= half; k += per) {
      e = 0; er = 0; end = k + per; pk = k;
      for (i = k; i < end; i++) {
        e += mag[i] * mag[i]; er += ref[i] * ref[i];
        if (mag[i] > mag[pk]) pk = i;
      }
      ratio = er > 0 ? e / er : 0;
      if (!best || ratio > best.ratio)
        best = { fromHz: k * sampleRate / fftSize, toHz: end * sampleRate / fftSize, ratio: ratio, peakHz: pk * sampleRate / fftSize };
    }
    return best && best.ratio >= 4 ? best : null;
  }

  /* ───────────── signaux de synthèse (ajouts web) ───────────── */

  var RATE = 48000;

  function prng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function toInt16(x) {
    var out = new Int16Array(x.length), i, v;
    for (i = 0; i < x.length; i++) {
      v = Math.round(x[i]);
      out[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
    }
    return out;
  }

  // Touche de clavier téléphonique : deux sinus aux fréquences normalisées.
  function synthDtmf(key, seconds) {
    var r, c = -1, n = Math.round((seconds || 0.5) * RATE), x = new Float64Array(n), i, t, env;
    for (r = 0; r < 4; r++) { c = DTMF_KEYS[r].indexOf(key); if (c >= 0) break; }
    if (c < 0) throw new Error('touche inconnue : ' + key);
    var fl = DTMF_LOW[r], fh = DTMF_HIGH[c], fade = 0.01 * RATE;
    for (i = 0; i < n; i++) {
      t = i / RATE;
      env = Math.min(1, i / fade, (n - 1 - i) / fade);
      x[i] = env * 9000 * (Math.sin(2 * Math.PI * fl * t) + Math.sin(2 * Math.PI * fh * t));
    }
    return toInt16(x);
  }

  /* Moteur à 1485 tr/min (24,75 Hz) : rotation et ses multiples, 100 Hz
     électrique, bruit de fond. Avec défaut : un choc à chaque passage d'une
     bille sur la piste abîmée (88,7 Hz), qui fait sonner la machine vers 3200 Hz. */
  function synthMotor(defect, seed) {
    var n = 3 * RATE, x = new Float64Array(n), rnd = prng(seed || 1), i, t, g;
    var fr = 24.75;
    for (i = 0; i < n; i++) {
      t = i / RATE;
      g = (rnd() + rnd() + rnd() + rnd() - 2) * 520;
      x[i] = 6000 * Math.sin(2 * Math.PI * fr * t)
           + 2500 * Math.sin(2 * Math.PI * 2 * fr * t + 0.7)
           + 1200 * Math.sin(2 * Math.PI * 3 * fr * t + 1.9)
           + 1800 * Math.sin(2 * Math.PI * 100 * t + 0.3)
           + g;
    }
    if (defect) {
      var period = RATE / (3.585 * fr), tau = 0.0015 * RATE, len = Math.round(8 * tau), p, j, amp;
      for (p = 0; p < n; p += period) {
        amp = 5000 * (0.85 + 0.3 * rnd());
        for (j = 0; j < len && Math.round(p) + j < n; j++)
          x[Math.round(p) + j] += amp * Math.exp(-j / tau) * Math.sin(2 * Math.PI * 3200 * j / RATE);
      }
    }
    return toInt16(x);
  }

  // Une petite mélodie, avec par-dessus la ronflette du secteur : 50, 150 et 250 Hz.
  function synthHum() {
    var notes = [261.63, 329.63, 392.0, 523.25, 440.0, 392.0, 329.63, 261.63];
    var noteLen = 0.5 * RATE, n = notes.length * noteLen, x = new Float64Array(n), i, k, t, env, h, s;
    var harm = [1, 0.5, 0.25, 0.12];
    for (k = 0; k < notes.length; k++) {
      for (i = 0; i < noteLen; i++) {
        t = i / RATE;
        env = Math.min(1, i / 240, (noteLen - 1 - i) / 480) * Math.exp(-t / 0.25);
        s = 0;
        for (h = 0; h < 4; h++) s += harm[h] * Math.sin(2 * Math.PI * notes[k] * (h + 1) * t);
        x[k * noteLen + i] = 5200 * env * s;
      }
    }
    for (i = 0; i < n; i++) {
      t = i / RATE;
      env = Math.min(1, i / 480, (n - 1 - i) / 480);
      x[i] += env * (4200 * Math.sin(2 * Math.PI * 50 * t)
                   + 2600 * Math.sin(2 * Math.PI * 150 * t + 0.4)
                   + 1500 * Math.sin(2 * Math.PI * 250 * t + 1.1));
    }
    return toInt16(x);
  }

  return {
    RATE: RATE, DFT_THRESHOLD: DFT_THRESHOLD, FRAME_SIZE: FRAME_SIZE, BASE_BIN: BASE_BIN,
    ENCODE_AMP: ENCODE_AMP, DETECT_THRESHOLD: DETECT_THRESHOLD, IDX_START: IDX_START, IDX_END: IDX_END,
    DTMF_LOW: DTMF_LOW, DTMF_HIGH: DTMF_HIGH, DTMF_KEYS: DTMF_KEYS,
    wavHeader: wavHeader, wavRead: wavRead, wavWrite: wavWrite, makeWav: makeWav,
    nextPow2: nextPow2, isPow2: isPow2, fft: fft, ifft: ifft,
    dftMagnitude: dftMagnitude, dftMagnitudeRange: dftMagnitudeRange, fftMagnitude: fftMagnitude,
    spectrum: spectrum, topFrequencies: topFrequencies, fmt1: fmt1, formatAnalyze: formatAnalyze,
    charToIdx: charToIdx, idxToChar: idxToChar, cypher: cypher, scanFrame: scanFrame, decypher: decypher,
    removeFrequencies: removeFrequencies, findPeaks: findPeaks, dtmfDetect: dtmfDetect,
    compareToReference: compareToReference,
    synthDtmf: synthDtmf, synthMotor: synthMotor, synthHum: synthHum
  };
});
