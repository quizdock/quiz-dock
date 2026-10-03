/**
 * The start of a real PNG of 1 × 1 pixel: its signature and its header chunk's
 * size. Tests add bytes of their own after it (different files, same content check).
 */
export const PNG_1X1 = Buffer.from([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a, // signature
  0,
  0,
  0,
  13,
  0x49,
  0x48,
  0x44,
  0x52, // IHDR, 13 bytes
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  1, // width 1, height 1
]);
