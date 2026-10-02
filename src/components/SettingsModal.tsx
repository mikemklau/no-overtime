'use client';

import React, { useState } from 'react';
import { triggerHaptic } from '@/lib/haptics';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail: string | null;
  subscriptionTier?: 'free' | 'pro';
  scansUsed?: number;
  scansLimit?: number;
  onSignOut: () => void;
  onAccountDeleted: () => void;
}

export function SettingsModal({
  isOpen,
  onClose,
  userEmail,
  subscriptionTier = 'free',
  scansUsed = 0,
  scansLimit = 5,
  onSignOut,
  onAccountDeleted,
}: SettingsModalProps) {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    setDeleteError(null);
    triggerHaptic('warning');

    try {
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error('Not authenticated. Please sign in again.');
      }

      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to delete account.');
      }

      // Sign out locally
      await supabase.auth.signOut();
      triggerHaptic('success');
      setIsConfirmingDelete(false);
      onAccountDeleted();
      onClose();
    } catch (err: unknown) {
      console.error('Delete account error:', err);
      setDeleteError(err instanceof Error ? err.message : 'Error deleting account.');
      triggerHaptic('error');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="w-full max-w-lg rounded-3xl bg-white p-6 md:p-8 shadow-2xl dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800 text-foreground font-black text-xl border border-zinc-200 dark:border-zinc-700">
              ⚙️
            </div>
            <div>
              <h2 className="text-xl md:text-2xl font-black text-foreground">
                Account &amp; Settings
              </h2>
              <p className="text-xs text-zinc-500 font-semibold">
                Manage your session and UK GDPR data
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              triggerHaptic('light');
              setIsConfirmingDelete(false);
              onClose();
            }}
            className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Account Details Card */}
        <div className="rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700/60 p-4 mb-6 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
              Signed In Email
            </span>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
              {subscriptionTier === 'pro' ? '★ Pro Plan' : 'Free Tier'}
            </span>
          </div>
          <p className="text-base font-bold text-foreground truncate">
            {userEmail || 'Anonymous Guest'}
          </p>

          <div className="pt-2 border-t border-zinc-200 dark:border-zinc-700/60 flex items-center justify-between text-xs text-zinc-500">
            <span>Cloud AI Scans Used:</span>
            <span className="font-bold text-foreground">
              {scansUsed} / {scansLimit}
            </span>
          </div>
        </div>

        {/* Error message */}
        {deleteError && (
          <div className="mb-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 p-3 text-xs font-semibold text-rose-800 dark:text-rose-300">
            {deleteError}
          </div>
        )}

        {/* Standard Actions */}
        {!isConfirmingDelete ? (
          <div className="space-y-4">
            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('light');
                  onSignOut();
                  onClose();
                }}
                className="h-12 w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 text-sm font-bold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition flex items-center justify-center gap-2"
              >
                <span>🚪 Sign Out</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  triggerHaptic('warning');
                  setIsConfirmingDelete(true);
                }}
                className="h-12 w-full rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/20 px-4 text-sm font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/40 transition flex items-center justify-center gap-2"
              >
                <span>🗑️ Delete Account &amp; Data (UK GDPR)</span>
              </button>
            </div>

            <div className="p-3 rounded-xl bg-zinc-100 dark:bg-zinc-800/40 text-[11px] text-zinc-500 leading-relaxed">
              <strong>UK GDPR Compliance:</strong> No Overtime stores data strictly in London (<code className="text-zinc-700 dark:text-zinc-300">eu-west-2</code>). Deleting your account permanently purges your user profile, receipts register, line items, and receipt images from cloud storage.
            </div>
          </div>
        ) : (
          /* Confirmation State */
          <div className="rounded-2xl border-2 border-rose-500/40 bg-rose-50/50 dark:bg-rose-950/30 p-5 space-y-4 animate-in fade-in duration-150">
            <div className="flex items-center gap-2 text-rose-700 dark:text-rose-300 font-bold text-sm">
              <span className="text-lg">⚠️</span>
              <span>Permanently Delete Everything?</span>
            </div>
            <p className="text-xs text-rose-800 dark:text-rose-300 leading-relaxed">
              This action cannot be undone. All your staged and synced receipts, VAT calculations, and uploaded images will be permanently erased from Supabase.
            </p>

            <div className="flex gap-2.5 pt-1">
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleDeleteAccount}
                className="flex-1 h-11 rounded-xl bg-rose-600 px-4 text-sm font-bold text-white shadow-md hover:bg-rose-700 active:scale-[0.98] transition disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                <span>{isDeleting ? 'Deleting...' : 'Yes, Delete Permanently'}</span>
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => {
                  triggerHaptic('light');
                  setIsConfirmingDelete(false);
                }}
                className="h-11 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 text-sm font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
