import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MobileTimerInstrument } from '../src/mobile/MobileTimerInstrument';
import { TIMER_STYLES } from '../shared/theme';

describe('mobile selected timer instrument', () => {
  for (const style of TIMER_STYLES) {
    it(`renders the selected ${style} instrument on the focus surface`, () => {
      const html = renderToStaticMarkup(
        createElement(MobileTimerInstrument, { ms: 65_000, state: 'paused', style }),
      );
      expect(html).toContain(
        style === 'standard' ? 'mobile-chronograph' : `data-selected-instrument="${style}"`,
      );
      if (style !== 'standard') expect(html).not.toContain('mobile-chronograph-readout');
      if (style !== 'standard') expect(html).toContain(`dial-${style}`);
    });
  }
});
