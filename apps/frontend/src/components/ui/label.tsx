import type { LabelHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('flex flex-col gap-1.5 text-sm font-medium leading-none', className)}
      {...props}
    />
  );
}
