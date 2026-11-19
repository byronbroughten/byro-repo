// The core of `npm run image:render`: SVG text in, PNG bytes out, through resvg, which needs no system install.
// imageRender.ts is the entry: it reads the named SVG file and writes the PNG beside it.
import { Resvg } from "@resvg/resvg-js";

export function pngOf(svg: string): Uint8Array {
  return new Resvg(svg).render().asPng();
}
