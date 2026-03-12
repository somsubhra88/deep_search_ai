/**
 * Memoized progress log component
 * Only re-renders when progress steps change
 */

import { memo } from 'react';
import { Loader2 } from 'lucide-react';

type ProgressStep = {
  step: string;
  detail: string;
  data?: Record<string, unknown>;
};

type ProgressLogProps = {
  steps: ProgressStep[];
  isDark?: boolean;
};

function ProgressLogComponent({ steps, isDark = true }: ProgressLogProps) {
  if (steps.length === 0) return null;

  return (
    <div
      className={`mb-12 rounded-2xl border p-6 ${
        isDark ? 'border-slate-700/60 bg-slate-800/30' : 'border-slate-200 bg-white/80'
      }`}
      role="log"
      aria-live="polite"
      aria-label="Research progress"
    >
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Live Progress
      </h2>
      <ul className="space-y-3">
        {steps.map((step, i) => (
          <ProgressStepItem key={i} step={step} isDark={isDark} />
        ))}
      </ul>
    </div>
  );
}

// Memoize individual step items for better performance
const ProgressStepItem = memo(
  ({ step, isDark }: { step: ProgressStep; isDark: boolean }) => {
    return (
      <li
        className={`flex items-start gap-3 rounded-lg px-4 py-3 text-sm transition ${
          isDark ? 'bg-slate-800/50' : 'bg-slate-100/80'
        }`}
      >
        <span className="mt-0.5 h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-500" />
        <div>
          <span className="text-slate-600 dark:text-slate-300">{step.detail}</span>
          {Array.isArray(step.data?.queries) && (
            <ul className="mt-2 list-inside list-disc text-slate-500">
              {(step.data.queries as string[]).map((q, j) => (
                <li key={j}>{q}</li>
              ))}
            </ul>
          )}
        </div>
      </li>
    );
  },
  (prev, next) => prev.step === next.step && prev.isDark === next.isDark
);

ProgressStepItem.displayName = 'ProgressStepItem';

// Memoize entire component
export const ProgressLog = memo(ProgressLogComponent, (prev, next) => {
  return (
    prev.steps.length === next.steps.length &&
    prev.steps[prev.steps.length - 1] === next.steps[next.steps.length - 1] &&
    prev.isDark === next.isDark
  );
});
