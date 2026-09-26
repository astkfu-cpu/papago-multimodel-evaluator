import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(root, "highlight-detector.js"), "utf8");
const context = vm.createContext({ Uint8Array, Int32Array, Math, globalThis: {} });
vm.runInContext(source, context);
const detector = context.globalThis.PapagoHighlightDetector;
if (!detector?.locate || !detector?.findContentBounds) throw new Error("Highlight detector did not load");

function image(width = 180, height = 120, color = [92, 87, 82]) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    pixels[index * 4] = color[0];
    pixels[index * 4 + 1] = color[1];
    pixels[index * 4 + 2] = color[2];
    pixels[index * 4 + 3] = 255;
  }
  return { width, height, pixels };
}

function setPixel(test, x, y, color) {
  if (x < 0 || y < 0 || x >= test.width || y >= test.height) return;
  const offset = (y * test.width + x) * 4;
  test.pixels[offset] = color[0];
  test.pixels[offset + 1] = color[1];
  test.pixels[offset + 2] = color[2];
}

function fill(test, left, top, right, bottom, color) {
  for (let y = top; y <= bottom; y += 1) for (let x = left; x <= right; x += 1) setPixel(test, x, y, color);
}

function frame(test, left, top, right, bottom, color = [70, 118, 190], missingSide = "") {
  for (let x = left; x <= right; x += 1) {
    if (missingSide !== "top") setPixel(test, x, top, color);
    if (missingSide !== "bottom") setPixel(test, x, bottom, color);
  }
  for (let y = top; y <= bottom; y += 1) {
    if (missingSide !== "left") setPixel(test, left, y, color);
    if (missingSide !== "right") setPixel(test, right, y, color);
  }
}

function ellipse(test, centerX, centerY, radiusX, radiusY) {
  for (let y = centerY - radiusY; y <= centerY + radiusY; y += 1) {
    for (let x = centerX - radiusX; x <= centerX + radiusX; x += 1) {
      const distance = ((x - centerX) ** 2) / (radiusX ** 2) + ((y - centerY) ** 2) / (radiusY ** 2);
      if (distance <= 1) setPixel(test, x, y, distance >= 0.72 ? [74, 123, 194] : [174, 160, 105]);
    }
  }
}

function assertCenter(result, x, y, label) {
  if (!result) throw new Error(`${label}: no result`);
  if (x < result.minX || x > result.maxX || y < result.minY || y > result.maxY) {
    throw new Error(`${label}: selected ${JSON.stringify(result)} does not contain ${x},${y}`);
  }
}

{
  const test = image();
  fill(test, 8, 8, 165, 28, [170, 154, 102]);
  fill(test, 55, 67, 127, 91, [168, 153, 108]);
  frame(test, 55, 67, 127, 91);
  const result = detector.locate(test.pixels, test.width, test.height);
  assertCenter(result, 90, 79, "framed block beats larger yellow distractor");
  if (result.mode !== "blue-frame") throw new Error("framed block did not use structural mode");
}

{
  const test = image(220, 150, [128, 32, 55]);
  // On a red package the translucent gray-yellow overlay becomes dark/greenish;
  // only a few warm pixels survive, but the thin blue rectangle remains complete.
  fill(test, 58, 54, 168, 86, [105, 90, 58]);
  fill(test, 70, 62, 76, 66, [170, 154, 102]);
  frame(test, 58, 54, 168, 86);
  const result = detector.locate(test.pixels, test.width, test.height);
  assertCenter(result, 112, 70, "tinted overlay on red product");
  if (result.mode !== "blue-frame") throw new Error("tinted product overlay did not use structural mode");
}

{
  const test = image(150, 150, [205, 205, 202]);
  for (let x = 15; x < 135; x += 1) setPixel(test, x, 18, [66, 112, 181]);
  ellipse(test, 42, 96, 10, 13);
  const result = detector.locate(test.pixels, test.width, test.height);
  assertCenter(result, 42, 96, "small oval block beats unrelated blue line");
}

{
  const test = image();
  fill(test, 18, 72, 91, 88, [176, 161, 108]);
  fill(test, 145, 12, 153, 108, [190, 174, 95]);
  const result = detector.locate(test.pixels, test.width, test.height);
  assertCenter(result, 55, 80, "horizontal yellow block beats vertical road-like strip");
}

{
  const test = image();
  frame(test, 10, 12, 76, 35);
  fill(test, 98, 68, 164, 96, [172, 157, 111]);
  frame(test, 98, 68, 164, 96);
  const result = detector.locate(test.pixels, test.width, test.height);
  assertCenter(result, 130, 82, "gray-yellow interior breaks frame tie");
}

{
  const test = image();
  fill(test, 38, 48, 142, 78, [170, 156, 112]);
  frame(test, 38, 48, 142, 78, [72, 120, 191], "right");
  const result = detector.locate(test.pixels, test.width, test.height);
  assertCenter(result, 90, 63, "three-sided compressed frame");
}

{
  const test = image(240, 160, [51, 51, 51]);
  fill(test, 70, 0, 169, 159, [225, 220, 212]);
  fill(test, 82, 20, 150, 130, [80, 110, 145]);
  const result = detector.findContentBounds(test.pixels, test.width, test.height);
  if (!result || result.minX > 72 || result.minX < 62 || result.maxX < 167 || result.maxX > 177) {
    throw new Error(`portrait content bounds wrong: ${JSON.stringify(result)}`);
  }
}

{
  const test = image(240, 160, [190, 170, 150]);
  for (let x = 0; x < test.width; x += 1) fill(test, x, 0, x, test.height - 1, [80 + (x % 90), 100 + (x % 60), 130]);
  const result = detector.findContentBounds(test.pixels, test.width, test.height);
  if (result) throw new Error(`full-width image should not be narrowed: ${JSON.stringify(result)}`);
}

console.log("Highlight detector regression checks passed (8 scenarios).");
