/**
 * 简单的 MD5 实现（用于缓存键生成）
 */
export function createMD5(text: string): string {
  const rotateLeft = (value: number, shift: number): number => {
    return (value << shift) | (value >>> (32 - shift));
  };

  const addUnsigned = (x: number, y: number): number => {
    const x4 = x & 0x80000000;
    const y4 = y & 0x80000000;
    const x8 = x & 0x40000000;
    const y8 = y & 0x40000000;
    const result = (x & 0x3fffffff) + (y & 0x3fffffff);
    if (x8 & y8) {
      return result ^ 0x80000000 ^ x4 ^ y4;
    }
    if (x8 | y8) {
      if (result & 0x40000000) {
        return result ^ 0xc0000000 ^ x4 ^ y4;
      }
      return result ^ 0x40000000 ^ x4 ^ y4;
    }
    return result ^ x4 ^ y4;
  };

  const F = (x: number, y: number, z: number): number => (x & y) | (~x & z);
  const G = (x: number, y: number, z: number): number => (x & z) | (y & ~z);
  const H = (x: number, y: number, z: number): number => x ^ y ^ z;
  const I = (x: number, y: number, z: number): number => y ^ (x | ~z);

  const FF = (a: number, b: number, c: number, d: number, x: number, s: number, ac: number): number => {
    a = addUnsigned(a, addUnsigned(addUnsigned(F(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  };

  const GG = (a: number, b: number, c: number, d: number, x: number, s: number, ac: number): number => {
    a = addUnsigned(a, addUnsigned(addUnsigned(G(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  };

  const HH = (a: number, b: number, c: number, d: number, x: number, s: number, ac: number): number => {
    a = addUnsigned(a, addUnsigned(addUnsigned(H(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  };

  const II = (a: number, b: number, c: number, d: number, x: number, s: number, ac: number): number => {
    a = addUnsigned(a, addUnsigned(addUnsigned(I(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  };

  const convertToWordArray = (str: string): number[] => {
    const wordCount = ((str.length + 8) >>> 6) + 1;
    const wordArray = new Array(wordCount * 16).fill(0);

    for (let i = 0; i < str.length; i++) {
      wordArray[i >>> 2] |= str.charCodeAt(i) << ((i % 4) * 8);
    }

    wordArray[str.length >>> 2] |= 0x80 << ((str.length % 4) * 8);
    wordArray[wordCount * 16 - 2] = str.length * 8;

    return wordArray;
  };

  const wordToHex = (value: number): string => {
    let hex = '';
    for (let i = 0; i <= 3; i++) {
      hex += ((value >>> (i * 8)) & 255).toString(16).padStart(2, '0');
    }
    return hex;
  };

  const x = convertToWordArray(text);
  const a = 0x67452301;
  const b = 0xefcdab89;
  const c = 0x98badcfe;
  const d = 0x10325476;

  const S11 = 7, S12 = 12, S13 = 17, S14 = 22;
  const S21 = 5, S22 = 9, S23 = 14, S24 = 20;
  const S31 = 4, S32 = 11, S33 = 16, S34 = 23;
  const S41 = 6, S42 = 10, S43 = 15, S44 = 21;

  let aa = a, bb = b, cc = c, dd = d;

  for (let k = 0; k < x.length; k += 16) {
    const A = aa, B = bb, C = cc, D = dd;

    aa = FF(aa, bb, cc, dd, x[k], S11, 0xd76aa478); dd = FF(dd, aa, bb, cc, x[k + 1], S12, 0xe8c7b756);
    cc = FF(cc, dd, aa, bb, x[k + 2], S13, 0x242070db); bb = FF(bb, cc, dd, aa, x[k + 3], S14, 0xc1bdceee);
    aa = FF(aa, bb, cc, dd, x[k + 4], S11, 0xf57c0faf); dd = FF(dd, aa, bb, cc, x[k + 5], S12, 0x4787c62a);
    cc = FF(cc, dd, aa, bb, x[k + 6], S13, 0xa8304613); bb = FF(bb, cc, dd, aa, x[k + 7], S14, 0xfd469501);
    aa = FF(aa, bb, cc, dd, x[k + 8], S11, 0x698098d8); dd = FF(dd, aa, bb, cc, x[k + 9], S12, 0x8b44f7af);
    cc = FF(cc, dd, aa, bb, x[k + 10], S13, 0xffff5bb1); bb = FF(bb, cc, dd, aa, x[k + 11], S14, 0x895cd7be);
    aa = FF(aa, bb, cc, dd, x[k + 12], S11, 0x6b901122); dd = FF(dd, aa, bb, cc, x[k + 13], S12, 0xfd987193);
    cc = FF(cc, dd, aa, bb, x[k + 14], S13, 0xa679438e); bb = FF(bb, cc, dd, aa, x[k + 15], S14, 0x49b40821);

    aa = GG(aa, bb, cc, dd, x[k + 1], S21, 0xf61e2562); dd = GG(dd, aa, bb, cc, x[k + 6], S22, 0xc040b340);
    cc = GG(cc, dd, aa, bb, x[k + 11], S23, 0x265e5a51); bb = GG(bb, cc, dd, aa, x[k], S24, 0xe9b6c7aa);
    aa = GG(aa, bb, cc, dd, x[k + 5], S21, 0xd62f105d); dd = GG(dd, aa, bb, cc, x[k + 10], S22, 0x2441453);
    cc = GG(cc, dd, aa, bb, x[k + 15], S23, 0xd8a1e681); bb = GG(bb, cc, dd, aa, x[k + 4], S24, 0xe7d3fbc8);
    aa = GG(aa, bb, cc, dd, x[k + 9], S21, 0x21e1cde6); dd = GG(dd, aa, bb, cc, x[k + 14], S22, 0xc33707d6);
    cc = GG(cc, dd, aa, bb, x[k + 3], S23, 0xf4d50d87); bb = GG(bb, cc, dd, aa, x[k + 8], S24, 0x455a14ed);
    aa = GG(aa, bb, cc, dd, x[k + 13], S21, 0xa9e3e905); dd = GG(dd, aa, bb, cc, x[k + 2], S22, 0xfcefa3f8);
    cc = GG(cc, dd, aa, bb, x[k + 7], S23, 0x676f02d9); bb = GG(bb, cc, dd, aa, x[k + 12], S24, 0x8d2a4c8a);

    aa = HH(aa, bb, cc, dd, x[k + 5], S31, 0xfffa3942); dd = HH(dd, aa, bb, cc, x[k + 8], S32, 0x8771f681);
    cc = HH(cc, dd, aa, bb, x[k + 11], S33, 0x6d9d6122); bb = HH(bb, cc, dd, aa, x[k + 14], S34, 0xfde5380c);
    aa = HH(aa, bb, cc, dd, x[k + 1], S31, 0xa4beea44); dd = HH(dd, aa, bb, cc, x[k + 4], S32, 0x4bdecfa9);
    cc = HH(cc, dd, aa, bb, x[k + 7], S33, 0xf6bb4b60); bb = HH(bb, cc, dd, aa, x[k + 10], S34, 0xbebfbc70);
    aa = HH(aa, bb, cc, dd, x[k + 13], S31, 0x289b7ec6); dd = HH(dd, aa, bb, cc, x[k], S32, 0xeaa127fa);
    cc = HH(cc, dd, aa, bb, x[k + 3], S33, 0xd4ef3085); bb = HH(bb, cc, dd, aa, x[k + 6], S34, 0x4881d05);
    aa = HH(aa, bb, cc, dd, x[k + 9], S31, 0xd9d4d039); dd = HH(dd, aa, bb, cc, x[k + 12], S32, 0xe6db99e5);
    cc = HH(cc, dd, aa, bb, x[k + 15], S33, 0x1fa27cf8); bb = HH(bb, cc, dd, aa, x[k + 2], S34, 0xc4ac5665);

    aa = II(aa, bb, cc, dd, x[k], S41, 0xf4292244); dd = II(dd, aa, bb, cc, x[k + 7], S42, 0x432aff97);
    cc = II(cc, dd, aa, bb, x[k + 14], S43, 0xab9423a7); bb = II(bb, cc, dd, aa, x[k + 5], S44, 0xfc93a039);
    aa = II(aa, bb, cc, dd, x[k + 12], S41, 0x655b59c3); dd = II(dd, aa, bb, cc, x[k + 3], S42, 0x8f0ccc92);
    cc = II(cc, dd, aa, bb, x[k + 10], S43, 0xffeff47d); bb = II(bb, cc, dd, aa, x[k + 1], S44, 0x85845dd1);
    aa = II(aa, bb, cc, dd, x[k + 8], S41, 0x6fa87e4f); dd = II(dd, aa, bb, cc, x[k + 15], S42, 0xfe2ce6e0);
    cc = II(cc, dd, aa, bb, x[k + 6], S43, 0xa3014314); bb = II(bb, cc, dd, aa, x[k + 13], S44, 0x4e0811a1);
    aa = II(aa, bb, cc, dd, x[k + 4], S41, 0xf7537e82); dd = II(dd, aa, bb, cc, x[k + 11], S42, 0xbd3af235);
    cc = II(cc, dd, aa, bb, x[k + 2], S43, 0x2ad7d2bb); bb = II(bb, cc, dd, aa, x[k + 9], S44, 0xeb86d391);

    aa = addUnsigned(aa, A); bb = addUnsigned(bb, B); cc = addUnsigned(cc, C); dd = addUnsigned(dd, D);
  }

  return (wordToHex(aa) + wordToHex(bb) + wordToHex(cc) + wordToHex(dd)).toLowerCase();
}
