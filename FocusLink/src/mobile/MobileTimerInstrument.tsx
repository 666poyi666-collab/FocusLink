import type { MobileAppearance } from './appearance';
import { TimerDial } from '../features/focus/TimerDial';
import { MobileFocusChronograph, type ChronographPhase } from './MobileFocusChronograph';

export function MobileTimerInstrument({
  ms,
  state,
  style,
}: {
  ms: number;
  state: ChronographPhase;
  style: MobileAppearance['timerStyle'];
}) {
  if (style === 'standard') return <MobileFocusChronograph ms={ms} state={state} />;
  return (
    <div className="mobile-timer-stage" data-selected-instrument={style}>
      <TimerDial ms={ms} state={state} style={style} />
    </div>
  );
}
