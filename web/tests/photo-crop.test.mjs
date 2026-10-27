import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const context = vm.createContext({ module: { exports: {} } });
vm.runInContext(readFileSync(new URL("../ui/photo-crop.js", import.meta.url), "utf8"), context);
const { photoCropRect: rect } = context.module.exports;
test("photo framing preserves a square within the image for portrait, landscape and zoomed crops", () => {
  for (const [width, height] of [[1200, 600], [600, 1200], [64, 64]]) {
    for (const zoom of [1, 2, 3]) {
      for (const [x, y] of [[width / 2, height / 2], [-100, -100], [width + 100, height + 100]]) {
        const crop = rect(width, height, zoom, x, y);
        assert.equal(crop.side, Math.min(width, height) / zoom);
        assert.ok(crop.x >= 0 && crop.y >= 0);
        assert.ok(crop.x + crop.side <= width && crop.y + crop.side <= height);
      }
    }
  }
});
test("a face away from the center can be selected instead of forced into the center crop", () => {
  const centered = rect(1200, 600, 1, 600, 300), moved = rect(1200, 600, 2, 1050, 150);
  assert.equal(centered.x, 300); assert.equal(moved.x, 900); assert.equal(moved.y, 0);
});
