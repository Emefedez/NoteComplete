import test from 'node:test';
import assert from 'node:assert/strict';
import { presetPreview, dnorm, dt, dchisq, dbinom, quantile } from './prefabs/r-math/preview.js';
import { render, normalize } from './prefabs/r-math/render.js';

const integrate = (fn, lo, hi, n = 20000) => { let s = 0; const h = (hi - lo) / n; for (let i = 0; i < n; i++) s += fn(lo + (i + 0.5) * h) * h; return s; };

test('R preview densities are the distributions R draws', () => {
  assert.ok(Math.abs(integrate((x) => dnorm(x, 3, 2), -20, 26) - 1) < 1e-6);
  assert.ok(Math.abs(dt(0, 1) - 1 / Math.PI) < 1e-9, 't with 1 df is Cauchy');
  assert.ok(Math.abs(integrate((x) => dt(x, 12), -200, 200) - 1) < 1e-4);
  assert.ok(Math.abs(dchisq(2, 2) - 0.5 * Math.exp(-1)) < 1e-9);
  assert.ok(Math.abs(integrate((x) => dchisq(x, 5), 0, 80) - 1) < 1e-5);
  const pmf = Array.from({ length: 16 }, (_, k) => dbinom(k, 15, 0.4));
  assert.ok(Math.abs(pmf.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(Math.abs(dbinom(6, 15, 0.4) - 0.2065976) < 1e-6, 'dbinom(6, 15, 0.4) in R');
  // quantile(c(14,15,16,17,18,19,21), c(.25,.5,.75)) in R: 15.5 17 18.5
  assert.deepEqual([0.25, 0.5, 0.75].map((q) => quantile([14, 15, 16, 17, 18, 19, 21], q)), [15.5, 17, 18.5]);
});

test('each preset previews its own plot, from its parameters', () => {
  const box = [50, 40, 450, 240];
  const of = (preset, params = {}, extra = {}) => presetPreview(normalize({ preset, params, ...extra }), box);
  assert.match(of('normal'), /<polygon[^>]*fill-opacity="0.22"/, 'normal: shaded region');
  assert.doesNotMatch(of('normal', { region: 'none' }), /<polygon/, 'no region: no shading');
  assert.match(of('t', { df: 4 }), /df = 4/);
  assert.match(of('chisq', { df: 1 }), /<polyline/, 'chi-squared with 1 df still draws');
  assert.equal((of('binomial', { size: 10, prob: 0.5 }).match(/<rect/g) || []).length, 11, 'binomial: a bar per k');
  const hist = of('histogram', { values: '1 2 2 3 3 3 4 4 5', bins: 5 });
  assert.equal((hist.match(/<rect/g) || []).length, 5, 'histogram: a bar per bin');
  assert.match(hist, /<polyline/, 'with its density line');
  assert.doesNotMatch(of('histogram', { density: false }), /<polyline/);
  const boxes = of('boxplot', { labelA: 'Antes', labelB: 'Después' });
  assert.equal((boxes.match(/<rect/g) || []).length, 2, 'boxplot: two boxes');
  assert.match(boxes, /Antes/);
  assert.match(boxes, /Después/);
  const scatter = of('scatter', { x: '1 2 3', y: '2 4 6' });
  assert.equal((scatter.match(/<circle/g) || []).length, 3);
  assert.match(scatter, /y = 0 \+ 2x/, 'the fitted line, as lm gives it');
  assert.match(of('custom', {}, { rCode: 'curve(sin, 0, pi)\nabline(h = 0)' }), /curve\(sin, 0, pi\)/, 'custom: its code');
  // Every number in the markup is finite.
  for (const preset of ['normal', 't', 'chisq', 'binomial', 'histogram', 'boxplot', 'scatter', 'custom']) assert.doesNotMatch(of(preset), /NaN|Infinity/, preset);
});

test('the card before R has run shows the preset preview; a rendered figure is kept', () => {
  assert.match(render({ preset: 'binomial' }).svg, /Binomial PMF[\s\S]*<rect[\s\S]*<rect/);
  assert.match(render({ preset: 'boxplot' }).svg, /Group A/);
});

test('an emptied data field uses the preset data, in R code and preview alike', async () => {
  const { buildPresetRCode } = await import('./prefabs/r-math/render.js');
  assert.match(buildPresetRCode({ preset: 'histogram', params: { values: '' } }), /v <- c\(12, 15/);
  assert.match(buildPresetRCode({ preset: 'scatter', params: { x: ' ', y: '' } }), /x <- c\(1, 2, 3/);
  assert.equal((presetPreview(normalize({ preset: 'boxplot', params: { groupA: '' } }), [0, 0, 400, 200]).match(/<rect/g) || []).length, 2);
});
