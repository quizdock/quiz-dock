import type { FieldIssue } from '@/lib/question-issues';
import { cn } from '@/lib/utils';

/**
 * What is wrong with a field, right under it (UI system §1.5): an error in the
 * destructive colour, what is left to finish in the warning one. Nothing when all is well.
 */
export function FieldMessage({ issues, className }: { issues: FieldIssue[]; className?: string }) {
  if (issues.length === 0) return null;
  // One line per distinct text: four pictures without alt say it once.
  const lines = [...new Map(issues.map((i) => [i.text, i])).values()];
  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      {lines.map((i) => (
        <p
          key={i.text}
          // An error is said as it appears (a refused save): a screen reader announces
          // only the field it lands on otherwise. What is left to finish stays quiet.
          role={i.tone === 'error' ? 'alert' : undefined}
          className={cn('text-xs', i.tone === 'error' ? 'text-destructive' : 'text-warning-text')}
        >
          {i.text}
        </p>
      ))}
    </div>
  );
}
