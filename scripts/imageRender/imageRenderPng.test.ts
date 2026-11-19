import { describe, expect, it } from "vitest";

import { pngOf } from "./imageRenderPng.ts";

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="45">
  <rect x="10" y="10" width="100" height="25" fill="#336699"/>
</svg>`;

// The IHDR chunk holds the width and height as big-endian words at bytes 16 and 20.
function sizeOf(png: Uint8Array): { width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe("pngOf", () => {
  it("renders SVG text as a PNG of the size the SVG sets", () => {
    const png = pngOf(svg);
    expect([...png.subarray(0, 8)]).toEqual(pngSignature);
    expect(sizeOf(png)).toEqual({ width: 120, height: 45 });
  });
});
