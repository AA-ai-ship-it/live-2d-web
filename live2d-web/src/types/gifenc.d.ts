/** gifenc 模块类型声明 */
declare module 'gifenc' {
  export interface GifEncoderInstance {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts?: {
        palette?: number[][]
        delay?: number
        transparent?: boolean
        transparentIndex?: number
        dispose?: number
        repeat?: number
      },
    ): void
    finish(): void
    bytes(): Uint8Array
    bytesView(): Uint8Array
    reset(): void
  }
  export function GIFEncoder(opts?: { auto?: boolean; initialCapacity?: number }): GifEncoderInstance
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    opts?: {
      format?: 'rgba4444' | 'rgb565' | 'rgba8888'
      oneBitAlpha?: boolean | number
      clearAlpha?: boolean
      clearAlphaThreshold?: number
      clearAlphaColor?: number
    },
  ): number[][]
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: number[][],
    format?: string,
  ): Uint8Array
}
