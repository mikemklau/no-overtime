'use client';

import React from 'react';
import { triggerHaptic } from '@/lib/haptics';

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  scansUsed?: number;
  scansLimit?: number;
}

export function UpgradeModal({
  isOpen,
  onClose,
  scansUsed = 5,
  scansLimit = 5,
}: UpgradeModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div
        className="w-full max-w-lg rounded-3xl bg-white p-6 md:p-8 shadow-2xl dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500 text-white font-black text-2xl shadow-md">
              ★
            </div>
            <div>
              <span className="inline-block rounded-md bg-amber-100 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-amber-900 dark:bg-amber-950 dark:text-amber-300">
                Quota Reached
              </span>
              <h2 className="text-xl md:text-2xl font-black text-foreground">
                Upgrade to Premium
              </h2>
            </div>
          </div>
          <button
            onClick={() => {
              triggerHaptic('light');
              onClose();
            }}
            className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="mb-6 rounded-2xl bg-amber-50 p-4 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800">
          <p className="text-sm md:text-base font-semibold text-amber-900 dark:text-amber-200">
            You have used all {scansUsed} of {scansLimit} free Cloud AI scans.
          </p>
          <p className="text-xs md:text-sm text-amber-800 dark:text-amber-300 mt-1">
            Unlimited offline on-device scans remain 100% free on mobile. Upgrade to Pro for unlimited OpenAI Vision parsing.
          </p>
        </div>

        <div className="space-y-3 mb-8">
          <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Everything in Pro:
          </h3>
          <ul className="space-y-2.5 text-sm md:text-base text-zinc-700 dark:text-zinc-200 font-medium">
            <li className="flex items-center gap-2.5">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 text-xs font-bold">
                ✓
              </span>
              Unlimited Cloud AI receipt & invoice parsing
            </li>
            <li className="flex items-center gap-2.5">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 text-xs font-bold">
                ✓
              </span>
              Crumpled & low-contrast thermal receipt restoration
            </li>
            <li className="flex items-center gap-2.5">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 text-xs font-bold">
                ✓
              </span>
              Instant HMRC-compliant multi-tab Excel export
            </li>
            <li className="flex items-center gap-2.5">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 text-xs font-bold">
                ✓
              </span>
              Secure UK GDPR vault with 6-year receipt retention
            </li>
          </ul>
        </div>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => {
              triggerHaptic('success');
              alert('Stripe Pro checkout integration will be connected with your live subscription tier!');
              onClose();
            }}
            className="flex h-14 w-full items-center justify-center rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-6 text-lg font-bold text-white shadow-xl shadow-emerald-600/25 transition-all hover:opacity-95 active:scale-[0.98]"
          >
            Upgrade to Pro – £9.99 / month
          </button>
          <button
            type="button"
            onClick={() => {
              triggerHaptic('light');
              onClose();
            }}
            className="flex h-12 w-full items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-700 text-base font-semibold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition"
          >
            Continue with Free Offline Scans
          </button>
        </div>
      </div>
    </div>
  );
}
