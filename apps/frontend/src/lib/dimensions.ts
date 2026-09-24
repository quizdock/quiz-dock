/** `1920 × 1080` for a media whose size is known; null for a sound or one not read. */
export function formatDimensions(width: number | null, height: number | null): string | null {
  return width && height ? `${width} × ${height}` : null;
}
