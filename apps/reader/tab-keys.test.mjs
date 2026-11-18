import test from "node:test";
import assert from "node:assert/strict";
import { tabForDigit } from "./tab-strip.js";

test("Ctrl + a digit picks a tab: 1–8 by place, 9 the last, none past the end or the one shown", () => {
  const list = [{ id: 4, active: true }, { id: 7 }, { id: 2 }];
  assert.equal(tabForDigit(list, 2), 7);
  assert.equal(tabForDigit(list, 3), 2);
  assert.equal(tabForDigit(list, 9), 2, "9: the last tab");
  assert.equal(tabForDigit(list, 5), null, "no fifth tab");
  assert.equal(tabForDigit(list, 1), null, "already shown");
  assert.equal(tabForDigit([], 1), null);
  assert.equal(tabForDigit(list, 0), null);
});
