/**
 * User-facing feedback for the ledger pull channel.
 *
 * The pull state and the pull notice were both tracked in `MobileApp`, but neither was
 * ever rendered: tapping the sync chip flipped a state nobody could see, and a failed
 * check looked exactly like a quiet success until the user opened the connection sheet.
 * Two projections fix that without inventing a second source of truth:
 *
 * - the top-bar chip answers "did my tap do anything" while a check runs;
 * - the settings card carries the human sentence the pull layer already produced
 *   (`presentMobileLedgerSync` notice / error text), so the reason survives the toast.
 *
 * Both are pure: the chip must stay a projection of state, and the notice wording has to
 * be assertable without a DOM.
 */
import type { MobileSettingsPullState } from './settingsStatusPresentation';

export interface MobileSyncActivityInput {
  /** A paired connection exists; without one the chip means '本机'. */
  configured: boolean;
  pullState: MobileSettingsPullState;
}

export interface MobileSyncActivity {
  /** Replaces the connection label while a ledger check runs; null keeps it. */
  label: string | null;
  /** Longer wording for title/aria-label; null keeps the connection wording. */
  detail: string | null;
}

/**
 * The chip keeps its connection wording as the default; only a running ledger check
 * overrides it. `error` is deliberately not overridden here: the chip still has to
 * report the live channel, and the failure sentence now shows up in the settings card.
 */
export function presentMobileSyncActivity(input: MobileSyncActivityInput): MobileSyncActivity {
  if (!input.configured) return { label: null, detail: null };
  if (input.pullState === 'pulling') return { label: '检查中', detail: '正在核对云端账本…' };
  return { label: null, detail: null };
}

export type MobileLedgerNoticeTone = 'active' | 'error' | 'neutral';

export interface MobileLedgerNoticePresentation {
  text: string;
  tone: MobileLedgerNoticeTone;
}

export interface PresentMobileLedgerNoticeInput {
  notice: string | null | undefined;
  pullState: MobileSettingsPullState;
}

/**
 * A blank notice renders nothing; the tone follows the pull state rather than the text,
 * because a stale sentence must not paint an old failure as an active check.
 */
export function presentMobileLedgerNotice(
  input: PresentMobileLedgerNoticeInput,
): MobileLedgerNoticePresentation | null {
  const text = (input.notice ?? '').trim();
  if (text === '') return null;
  const tone: MobileLedgerNoticeTone =
    input.pullState === 'error' ? 'error' : input.pullState === 'pulling' ? 'active' : 'neutral';
  return { text, tone };
}
