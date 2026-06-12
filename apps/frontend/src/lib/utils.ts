import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Fusionne des classes Tailwind (clsx + tailwind-merge) — convention shadcn/ui. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
