'use client';
import React from 'react';
import Link from 'next/link';
import {AlertCircle, MapPin, Sparkles, Users} from 'lucide-react';
import type {MatchListNoticeKind, MatchListNoticeCopy} from '../lib/matchListState';

const ICONS: Record<MatchListNoticeKind, React.ComponentType<{className?: string}>> = {
  locationUnavailable: MapPin, nobodyInRange: Users, noneEligible: Sparkles, loadFailed: AlertCircle,
};
const FRAME: Record<MatchListNoticeCopy['tone'], string> = {
  blocked: 'border-amber-400/40 bg-amber-500/10', quiet: 'border-white/20 bg-black/70',
  failed: 'border-red-500/30 bg-black/70',
};
const BADGE: Record<MatchListNoticeCopy['tone'], string> = {
  blocked: 'bg-amber-400/20 border-amber-400/30 text-amber-300',
  quiet: 'bg-white/10 border-white/20 text-white', failed: 'bg-red-500/15 border-red-400/30 text-red-300',
};

/**
 * One notice for every reason the list is not a list. onRetry is omitted where the
 * caller cannot re-run the request, and the retry button is then omitted too rather
 * than offering a control that does nothing.
 */
export function MatchListNotice(
  {kind, copy, onRetry}: {kind: MatchListNoticeKind; copy: MatchListNoticeCopy; onRetry?: () => void},
) {
  const Icon = ICONS[kind];
  return <div role="status" data-match-state={kind}
    className={`mt-12 flex flex-col items-center text-center p-8 rounded-[28px] border backdrop-blur-xl shadow-2xl ${FRAME[copy.tone]}`}>
    <div className={`flex h-14 w-14 items-center justify-center rounded-full border ${BADGE[copy.tone]}`}>
      <Icon className="h-7 w-7" />
    </div>
    <h3 className="mt-4 text-[18px] font-extrabold text-white">{copy.headline}</h3>
    <p className="mt-2 text-[13.5px] leading-relaxed text-white/80 max-w-[320px]">{copy.body}</p>
    {copy.retryLabel && onRetry && <button type="button" onClick={onRetry}
      className="mt-5 rounded-full bg-white px-5 py-2 text-[13px] font-bold text-black shadow-md transition-transform hover:scale-105">
      {copy.retryLabel}
    </button>}
    {kind === 'noneEligible' && <Link href="/you/deeper" className="mt-6">
      <span className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-[13.5px] font-bold text-black shadow-lg transition-transform hover:scale-105">
        <Sparkles className="h-4 w-4" /> Deepen Your Pass
      </span>
    </Link>}
  </div>;
}
