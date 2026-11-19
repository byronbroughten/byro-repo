// `npm run image:render -- <svg file>`: writes a PNG of the same name beside the SVG.
// The core is pngRender.ts; this parses the argument, reads the SVG and writes the PNG.
import { readFileSync, writeFileSync } from "node:fs";

import { pngOf } from "./pngRender.ts";

const usage =
  "Usage: npm run image:render -- <svg file>; writes a PNG of the same name beside it";

const svgPath = process.argv[2];
if (svgPath === undefined || !svgPath.endsWith(".svg")) {
  console.error(usage);
  process.exitCode = 1;
} else {
  const pngPath = `${svgPath.slice(0, -".svg".length)}.png`;
  writeFileSync(pngPath, pngOf(readFileSync(svgPath, "utf8")));
  console.log(`Wrote ${pngPath}`);
}
