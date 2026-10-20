export const imageLimits = Object.freeze({
  maxTextCharacters: 30000,
  maxPixels: 6000000,
  maxPngBytes: 2097152,
});
export class PufuImageError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PufuImageError';
  }
}
