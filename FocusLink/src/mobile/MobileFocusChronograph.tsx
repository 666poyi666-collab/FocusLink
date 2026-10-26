// 专注页主时间读数。
//
// 设计意图：读数就是这一页的视觉中心，所以它不放在任何卡片里，也不做点阵仪表。
// 不足 1 小时显示 MM:SS，满 1 小时自动扩到 H:MM:SS；秒是独立 segment，冒号是
// 会呼吸的分隔符。数字全部走等宽字体（tabular-nums），字号用 clamp 收敛，
// 长时长收窄而不是截断或换行。

export type ChronographPhase = 'idle' | 'running' | 'paused' | 'ended';

export interface MobileChronographFormat {
  /** 小时位（不足 1 小时为 '0'，此时不渲染） */
  hours: string;
  /** 分钟位，始终两位 */
  minutes: string;
  /** 秒位，始终两位 */
  seconds: string;
  /** 视觉读数文本：MM:SS 或 H:MM:SS */
  text: string;
  /** 屏幕阅读器文本：中文整句 */
  accessible: string;
  /** 当前这一分钟内的秒针进度 0–1 */
  sweep: number;
}

/**
 * 把毫秒换算成读数片段。纯函数：同一个输入永远得到同一个读数，
 * 便于在一秒一次的重渲染里直接调用。
 */
export function formatMobileChronograph(ms: number): MobileChronographFormat {
  const safeMs = Number.isFinite(ms) ? Math.max(0, Math.floor(ms)) : 0;
  const totalSeconds = Math.floor(safeMs / 1000);
  const hourValue = Math.floor(totalSeconds / 3600);
  const minuteValue = Math.floor((totalSeconds % 3600) / 60);
  const secondValue = totalSeconds % 60;

  const hours = `${hourValue}`;
  const minutes = `${minuteValue}`.padStart(2, '0');
  const seconds = `${secondValue}`.padStart(2, '0');

  return {
    hours,
    minutes,
    seconds,
    text: hourValue > 0 ? `${hours}:${minutes}:${seconds}` : `${minutes}:${seconds}`,
    accessible:
      hourValue > 0
        ? `已专注 ${hourValue} 小时 ${minuteValue} 分 ${secondValue} 秒`
        : `已专注 ${minuteValue} 分 ${secondValue} 秒`,
    sweep: (safeMs % 60_000) / 60_000,
  };
}

export interface MobileFocusChronographProps {
  ms: number;
  state?: ChronographPhase;
}

export function MobileFocusChronograph({ ms, state = 'idle' }: MobileFocusChronographProps) {
  const readout = formatMobileChronograph(ms);
  const showHours = readout.hours !== '0';

  return (
    <div
      className="mobile-chronograph"
      role="timer"
      aria-live="off"
      aria-label={readout.accessible}
      data-state={state}
      data-long={showHours ? 'true' : 'false'}
    >
      <p className="mobile-chronograph-readout" aria-hidden="true">
        {showHours ? (
          <>
            <span className="mobile-chronograph-segment">{readout.hours}</span>
            <span className="mobile-chronograph-separator">:</span>
          </>
        ) : null}
        <span className="mobile-chronograph-segment">{readout.minutes}</span>
        <span className="mobile-chronograph-separator">:</span>
        <span className="mobile-chronograph-segment">{readout.seconds}</span>
      </p>
      <span className="mobile-chronograph-sweep-track" aria-hidden="true">
        <span
          className="mobile-chronograph-sweep"
          style={{ transform: `scaleX(${readout.sweep})` }}
        />
      </span>
    </div>
  );
}
