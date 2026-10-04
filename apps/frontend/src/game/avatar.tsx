import multiavatar from '@multiavatar/multiavatar';
import { Wifi } from 'lucide-react';
import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { BACKDROP_EDGE } from './surface';

/**
 * Avatar déterministe dérivé du pseudo (lib `multiavatar`, METIER §79) : purement
 * cosmétique côté client, aucun impact sur le contrat live. Affiché en lobby,
 * classement et podium. Le SVG est mémoïsé par pseudo.
 */
export function Avatar({
  name,
  size = 40,
  ready = false,
  remote,
  className,
}: {
  name: string;
  /** Pixels, or any CSS length (`'1.75em'` to follow the surrounding text). */
  size?: number | string;
  /** Said ready (the lobby): a green ring, a white gap inside it for a green avatar. */
  ready?: boolean;
  /** Playing from elsewhere: a small badge, labelled with this text. */
  remote?: string;
  className?: string;
}) {
  const svg = useMemo(() => multiavatar(name || '?'), [name]);
  const face = (
    <span
      aria-hidden
      className={cn(
        'inline-block shrink-0 overflow-hidden rounded-full [&_svg]:h-full [&_svg]:w-full',
        BACKDROP_EDGE,
        ready && 'ring-success ring-offset-background ring-[0.06em] ring-offset-[0.05em]',
        !remote && className,
      )}
      // 1em = its size: the ring and the badge are drawn in its proportions.
      style={
        remote ? { width: '1em', height: '1em' } : { width: '1em', height: '1em', fontSize: size }
      }
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
  if (!remote) return face;
  return (
    <span className={cn('relative inline-flex shrink-0', className)} style={{ fontSize: size }}>
      {face}
      <span
        role="img"
        aria-label={remote}
        title={remote}
        className="bg-background text-muted-foreground absolute -right-[0.12em] -bottom-[0.12em] grid size-[0.45em] place-items-center rounded-full border"
      >
        <Wifi className="size-[0.3em]" aria-hidden />
      </span>
    </span>
  );
}
