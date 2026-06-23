import multiavatar from '@multiavatar/multiavatar';
import { useMemo } from 'react';
import { cn } from '@/lib/utils';

/**
 * Avatar déterministe dérivé du pseudo (lib `multiavatar`, METIER §79) : purement
 * cosmétique côté client, aucun impact sur le contrat live. Affiché en lobby,
 * classement et podium. Le SVG est mémoïsé par pseudo.
 */
export function Avatar({
  name,
  size = 40,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const svg = useMemo(() => multiavatar(name || '?'), [name]);
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block shrink-0 overflow-hidden rounded-full [&_svg]:h-full [&_svg]:w-full',
        className,
      )}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
