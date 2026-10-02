'use client';

import React from 'react';
import { triggerHaptic } from '@/lib/haptics';

interface EngineInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function EngineInfoModal({ isOpen, onClose }: EngineInfoModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 md:p-8 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
        {/* Close button */}
        <button
          type="button"
          onClick={() => {
            triggerHaptic('light');
            onClose();
          }}
          className="absolute top-5 right-5 h-9 w-9 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:text-foreground flex items-center justify-center transition"
          title="Close modal"
        >
          ✕
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 text-2xl">
            ℹ️
          </div>
          <div>
            <h2 className="text-xl md:text-2xl font-black text-foreground">
              OCR vs. AI Parsing
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">
              Which engine should you use for your receipts?
            </p>
          </div>
        </div>

        <div className="space-y-4 text-sm text-zinc-600 dark:text-zinc-300">
          {/* Offline OCR Box */}
          <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700/60">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-bold text-foreground flex items-center gap-1.5">
                <span>⚡ Free Offline OCR</span>
              </h3>
              <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                On-Device
              </span>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3 leading-relaxed">
              Optical Character Recognition runs 100% locally on your browser CPU. Your data never leaves your device and runs completely offline &amp; free.
            </p>
            <div className="space-y-1.5 text-xs">
              <div className="flex items-start gap-1.5">
                <span className="text-emerald-600 dark:text-emerald-400 font-bold">✓ Best for:</span>
                <span>Clean printed receipts, PDFs, digital invoices, high-contrast images.</span>
              </div>
              <div className="flex items-start gap-1.5">
                <span className="text-amber-600 dark:text-amber-400 font-bold">⚠️ Best avoided for:</span>
                <span>Crumpled paper, blurry photos, handwriting, or low-light receipts.</span>
              </div>
            </div>
          </div>

          {/* AI Parsing Box */}
          <div className="p-4 rounded-2xl bg-purple-50/60 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800/40">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-bold text-foreground flex items-center gap-1.5">
                <span>✨ AI Receipt Parsing</span>
              </h3>
              <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200">
                Cloud Vision AI
              </span>
            </div>
            <p className="text-xs text-purple-900/80 dark:text-purple-300/80 mb-3 leading-relaxed">
              Uses advanced Vision AI models to understand document layouts, HMRC VAT rules, line items, and messy text with human-level accuracy.
            </p>
            <div className="space-y-1.5 text-xs">
              <div className="flex items-start gap-1.5">
                <span className="text-purple-700 dark:text-purple-300 font-bold">✓ Best for:</span>
                <span>Camera photos, handwritten receipts, folded/faded paper, and restaurant bills.</span>
              </div>
              <div className="flex items-start gap-1.5">
                <span className="text-purple-700/80 dark:text-purple-400/80 font-bold">ℹ️ Note:</span>
                <span>Requires internet connection &amp; consumes AI scan credits.</span>
              </div>
            </div>
          </div>

          {/* Recommendation Tip */}
          <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-900 dark:text-emerald-200 leading-relaxed">
            <span className="font-bold">💡 Recommended Workflow:</span> Upload using <strong>Free Offline OCR</strong> first. If any receipt is blurry or needs higher precision, click <strong className="whitespace-nowrap">&quot;✨ Enhance with AI&quot;</strong> on that specific receipt!
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            triggerHaptic('light');
            onClose();
          }}
          className="mt-6 w-full h-12 rounded-2xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-bold shadow-lg hover:opacity-90 active:scale-[0.98] transition"
        >
          Got it, thanks!
        </button>
      </div>
    </div>
  );
}
