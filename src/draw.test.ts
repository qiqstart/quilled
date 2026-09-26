import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ITALIC_ANGLE, fountainAngle, italicPressure, joinUrl, pencilWidth, sheetPoint, stainLeft } from "./draw.ts";
import { NIB_ANGLE } from "../quill/calligraphy.ts";

describe("quilled brushes", () => {
  it("makes a heavier pencil mark when the pencil presses harder", () => {
    const light = pencilWidth(2.5, 0.1);
    const heavy = pencilWidth(2.5, 0.95);
    assert.ok(heavy > light * 1.8);
  });

  it("lets italic pressure move only a little", () => {
    const light = italicPressure(0);
    const heavy = italicPressure(1);
    assert.ok(light > 0.7);
    assert.ok(heavy < 1.15);
    assert.ok(heavy - light < 0.4);
  });

  it("keeps the italic nib fixed and lets the fountain follow the barrel", () => {
    assert.ok(Math.abs(ITALIC_ANGLE - (-55 * Math.PI) / 180) < 0.001);
    assert.ok(Math.abs(fountainAngle(0) - NIB_ANGLE) < 0.001);
    assert.notEqual(fountainAngle(0.8), fountainAngle(0));
  });

  it("uses up the ink on a finger as it smears", () => {
    assert.ok(stainLeft(1, 0) > stainLeft(1, 200));
    assert.equal(stainLeft(0.1, 400), 0);
  });

  it("puts a point back on the sheet after the page is turned", () => {
    const box = { left: 0, top: 0, width: 200, height: 400, clientWidth: 200, clientHeight: 400 };
    const rest = sheetPoint(150, 200, box, 0);
    assert.ok(Math.abs(rest.x - 150) < 0.01);
    assert.ok(Math.abs(rest.y - 200) < 0.01);
    const turned = sheetPoint(100, 250, box, 90);
    assert.ok(Math.abs(turned.x - 150) < 0.01);
    assert.ok(Math.abs(turned.y - 200) < 0.01);
  });

  it("puts the desk name on the share link", () => {
    const url = joinUrl("https://letters.example/write", "q-evening");
    assert.equal(url, "https://letters.example/write?desk=evening");
  });
});
