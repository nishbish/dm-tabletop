import { describe, expect, it } from 'vitest';
import { frameDelay, mayBeAnimated } from './animated-picture.js';

function bytes(text: string, extra: number[] = []) {
  return Uint8Array.from([...text].map((c) => c.charCodeAt(0)).concat(extra));
}

// RIFF, size, WEBP, VP8X, chunk size, then the flags byte
function webp(chunk: string, flags: number) {
  return bytes(`RIFF\0\0\0\0WEBP${chunk}\0\0\0\0`, [flags, 0, 0, 0]);
}

describe('mayBeAnimated', () => {
  it('accepts GIFs, a single frame is found out when decoding', () => {
    expect(mayBeAnimated(bytes('GIF89a'))).toBe(true);
    expect(mayBeAnimated(bytes('GIF87a'))).toBe(true);
  });

  it('reads the animation flag of a WebP', () => {
    expect(mayBeAnimated(webp('VP8X', 0x02))).toBe(true);
    expect(mayBeAnimated(webp('VP8X', 0x12))).toBe(true);
    expect(mayBeAnimated(webp('VP8X', 0x10))).toBe(false); // alpha only
    expect(mayBeAnimated(webp('VP8 ', 0x02))).toBe(false); // the simple format has no animation
  });

  it('rejects everything else, including a file cut short', () => {
    expect(mayBeAnimated(bytes('\x89PNG\r\n'))).toBe(false);
    expect(mayBeAnimated(Uint8Array.from([0xff, 0xd8, 0xff]))).toBe(false);
    expect(mayBeAnimated(bytes('RIFF'))).toBe(false);
    expect(mayBeAnimated(new Uint8Array(0))).toBe(false);
  });
});

describe('frameDelay', () => {
  it('uses the delay of the frame, in microseconds', () => {
    expect(frameDelay({ duration: 200000 })).toBe(200);
  });

  it('limits a very fast GIF to about 15 frames per second', () => {
    expect(frameDelay({ duration: 10000 })).toBe(66);
  });

  it('falls back when a frame has no delay', () => {
    expect(frameDelay({ duration: null })).toBe(100);
    expect(frameDelay({ duration: 0 })).toBe(100);
  });
});
