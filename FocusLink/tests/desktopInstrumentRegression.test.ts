import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('desktop instrument visual regression contract', () => {
  it('keeps the green focus material on the continuous frosted path without caterpillar particles', () => {
    const source = readFileSync(resolve('src/features/focus/TemporalRibbon.tsx'), 'utf8');
    const focusSection = source.slice(
      source.indexOf('function drawFocusMaterial('),
      source.indexOf('/* ─── 暂停：疤痕 + 前沿消散'),
    );

    expect(focusSection).toContain('drawFrostedFocusRibbon');
    expect(focusSection).toContain('保持上下沿完全平直');
    expect(focusSection).not.toMatch(/pauseFrontierDissolveParticles|traceResidueDot|\.arc\(/);
  });

  it('keeps the packaged UI smoke fail-closed on all nine preview bounds', () => {
    const smoke = readFileSync(resolve('scripts/smoke/ui-state-smoke.cjs'), 'utf8');

    expect(smoke).toContain("document.querySelector('.stats-ledger-chart')");
    expect(smoke).toContain("document.querySelector('.stats-time-donut')");
    expect(smoke).not.toContain('.stats-timeline-detail');
    expect(smoke).not.toContain('.stats-focus-gauge');
    expect(smoke).toContain('previewCount === 9');
    expect(smoke).toContain('previewBounds.every((preview) => preview.inside)');
    expect(smoke).toContain('all nine timer instrument previews fit completely inside');
  });

  it('keeps the dashboard compact before the 1240px two-rail threshold and motion-reduced', () => {
    const styles = readFileSync(resolve('src/styles/linear-workbench.css'), 'utf8');

    expect(styles).toContain('@media (max-width: 1239px)');
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.stats-time-donut \.segment/,
    );
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.stats-day-column/);
  });

  it('renders the 24-hour rhythm chart as an explicit day instrument with periods and columns', () => {
    const source = readFileSync(resolve('src/features/history/HistoryInsights.tsx'), 'utf8');
    const styles = readFileSync(resolve('src/styles/stats-workbench.css'), 'utf8');

    expect(source).toContain('period-capsule-row');
    expect(source).toContain('bars-row');
    expect(styles).toContain('.period-cap-card');
    expect(styles).toContain('.bar-col');
    expect(styles).toContain('.bar-track');
    expect(styles).toContain('.bar-seg-focus');
  });

  it('keeps the main timer frame singular and its industrial labels readable', () => {
    const styles = readFileSync(resolve('src/styles/focuslink-2.css'), 'utf8');

    expect(styles).toMatch(
      /\.timer-zone\s*\{[^}]*border-radius:\s*0[^}]*background:\s*rgb\(var\(--app-bg\)/,
    );
    expect(styles).toMatch(/\.timer-zone \.dial-standard\s*\{[^}]*width:\s*min\(100%,\s*820px\)/);
    expect(styles).toMatch(/\.timer-zone \.instrument-chrome-label,[\s\S]*?font-size:\s*10px/);
  });

  it('uses distinct semantic colors for focus, pause, gap, night and now', () => {
    const tokens = readFileSync(resolve('src/styles/temporal-foundation.css'), 'utf8');
    const desktop = readFileSync(resolve('src/styles/focuslink-2.css'), 'utf8');
    const mobile = readFileSync(resolve('src/mobile/focuslink-2-mobile.css'), 'utf8');

    expect(tokens).toContain('--app-ledger-gap: 74 101 119');
    expect(tokens).toContain('--app-ledger-night: 231 234 235');
    expect(tokens).toContain('--app-ledger-day: 250 250 247');
    expect(tokens).toContain('--app-ledger-now: var(--app-warning)');
    for (const styles of [desktop, mobile]) {
      expect(styles).toContain('rgb(var(--app-ledger-gap) / 0.18)');
      expect(styles).toContain('rgb(var(--app-ledger-night))');
      expect(styles).toContain('rgb(var(--app-ledger-now))');
    }
  });
});
