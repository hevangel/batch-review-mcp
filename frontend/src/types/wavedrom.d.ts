/**
 * Minimal type declarations for the `wavedrom` package.
 *
 * The upstream package does not ship TypeScript types, so we declare only
 * the subset of its API that this project uses: converting a parsed
 * WaveJSON object into an onml node tree, and stringifying that tree into
 * an SVG markup string.
 */
declare module "wavedrom" {
  export type OnmlNode = [string, Record<string, unknown>, ...unknown[]];

  export function renderAny(
    index: number,
    source: Record<string, unknown>,
    waveSkin: unknown,
    notFirstSignal?: boolean
  ): OnmlNode;

  export const waveSkin: unknown;

  export const onml: {
    stringify(node: OnmlNode, indentation?: number): string;
  };
}
