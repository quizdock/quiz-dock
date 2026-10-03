import type { RoomSoundsPayload, RoomSoundsSettings } from '@quiz-dock/contracts';
import { Play, SlidersHorizontal, Volume2, VolumeX } from 'lucide-react';
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useMediaControllerInstance, useMediaControllerList } from '../api/generated/media/media';
import { MediaUpload } from '../routes/media-upload';
import { type RoomEffect, previewEffect } from './media/game-sounds';
import { SimpleDialog } from './media/sound-button';
import { formatPercent } from '@/lib/format';

/**
 * The room's mixer (#93): the same controls, from the console's control bar,
 * at any moment of a quiz — a level may need to move while players answer.
 */
export function RoomSoundsButton({
  sounds,
  onChange,
}: {
  sounds: RoomSoundsPayload | null;
  onChange: (patch: RoomSoundsSettings) => void;
}) {
  const { t } = useTranslation('live');
  const [open, setOpen] = useState(false);
  if (!sounds) return null;
  return (
    <>
      {/* The room's sound state stays in view in the control bar: muted, it says so. */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={sounds.muted ? t('control.sounds.roomMuted') : t('control.sounds.title')}
        title={sounds.muted ? t('control.sounds.roomMuted') : t('control.sounds.title')}
        className={cn(sounds.muted && 'border-destructive text-destructive')}
        onClick={() => setOpen(true)}
      >
        {sounds.muted ? <VolumeX className="size-4" /> : <SlidersHorizontal className="size-4" />}
        <span className="hidden sm:inline">
          {sounds.muted ? t('control.sounds.roomMuted') : t('control.sounds.title')}
        </span>
      </Button>
      <SimpleDialog open={open} title={t('control.sounds.title')} onClose={() => setOpen(false)}>
        <GameSoundsControls sounds={sounds} onChange={onChange} />
      </SimpleDialog>
    </>
  );
}

/** The controls themselves: the effects, the track, the two levels. */
type SoundKey = 'tickId' | 'gongId' | 'dingId' | 'countdownId' | 'musicId';

/**
 * One of the room's sounds: the built-in one (or none, for the track), or a
 * sound of the library — then the editor's own picker: upload one, take one of
 * *My sounds*, or of the instance's.
 */
function SoundSlot({
  label,
  none,
  mediaId,
  chosen,
  onChange,
  disabled = false,
}: {
  /** Read by screen readers; the row around it says it on screen. */
  label: string;
  none: string;
  mediaId: string | null;
  chosen: boolean;
  onChange: (mediaId: string | null) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation('live');
  const [fromLibrary, setFromLibrary] = useState(chosen);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Select
        className="h-8"
        aria-label={label}
        disabled={disabled}
        value={fromLibrary ? 'library' : ''}
        onChange={(e) => {
          const library = e.target.value === 'library';
          setFromLibrary(library);
          if (!library) onChange(null);
        }}
      >
        <option value="">{none}</option>
        <option value="library">{t('control.sounds.fromLibrary')}</option>
      </Select>
      {fromLibrary && !disabled ? (
        <MediaUpload
          kind="audio"
          value={mediaId}
          withDetails={false}
          label={t('control.sounds.addSound')}
          onChange={(id) => onChange(id)}
        />
      ) : null}
    </div>
  );
}

export function GameSoundsControls({
  sounds,
  onChange,
}: {
  sounds: RoomSoundsPayload;
  onChange: (patch: RoomSoundsSettings) => void;
}) {
  const { t } = useTranslation('live');
  const mine = useMediaControllerList({ kind: 'audio' }).data?.data ?? [];
  const instance = useMediaControllerInstance({ kind: 'audio' }).data?.data ?? [];
  const options = [
    ...mine.map((m) => ({ id: m.id, url: m.url, label: m.name || m.id })),
    ...instance.map((m) => ({
      id: m.id,
      url: m.url,
      label: t('control.sounds.instanceMedia', { name: m.name || m.id }),
    })),
  ];
  // The choice is kept as a URL on the screens' side: find its media back by it.
  const idOf = (url: string | null) => options.find((o) => o.url === url)?.id ?? '';
  const picker = (
    label: string,
    url: string | null,
    none: string,
    key: SoundKey,
    disabled = false,
  ) => (
    <SoundSlot
      key={key}
      label={label}
      none={none}
      mediaId={idOf(url) || null}
      chosen={url !== null}
      disabled={disabled}
      onChange={(id) => onChange({ [key]: id ?? '' })}
    />
  );

  // A channel's level on its section's title line: its mute, its fader, its value.
  const level = (
    label: string,
    value: number,
    key: 'musicLevel' | 'sfxLevel' | 'mediaLevel',
    muteKey: 'musicMuted' | 'sfxMuted' | 'mediaMuted',
  ) => (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 shrink-0"
        aria-pressed={sounds[muteKey]}
        aria-label={t(
          sounds[muteKey] ? 'control.sounds.unmuteChannel' : 'control.sounds.muteChannel',
          {
            bus: label,
          },
        )}
        title={t(sounds[muteKey] ? 'control.sounds.unmuteChannel' : 'control.sounds.muteChannel', {
          bus: label,
        })}
        onClick={() => onChange({ [muteKey]: !sounds[muteKey] })}
      >
        {sounds[muteKey] ? (
          <VolumeX className="text-destructive size-4" />
        ) : (
          <Volume2 className="size-4" />
        )}
      </Button>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        aria-label={label}
        value={Math.round(value * 100)}
        onChange={(e) => onChange({ [key]: Number(e.target.value) / 100 })}
        className={cn(
          'accent-primary min-w-0 flex-1',
          (sounds[muteKey] || sounds.muted) && 'opacity-40',
        )}
      />
      <span className="w-11 shrink-0 text-right text-xs whitespace-nowrap tabular-nums">
        {formatPercent(value)}
      </span>
    </span>
  );

  // The effects in the order the game plays them, each built the same way: on or
  // off, and its sound — the built-in one, or one of the library.
  const effects: {
    on: RoomEffect;
    id: SoundKey;
    url: string | null;
  }[] = [
    { on: 'ding', id: 'dingId', url: sounds.dingUrl },
    { on: 'tick', id: 'tickId', url: sounds.tickUrl },
    { on: 'countdown', id: 'countdownId', url: sounds.countdownUrl },
    { on: 'gong', id: 'gongId', url: sounds.gongUrl },
  ];

  const heading = (id: string, title: string) => (
    <h3 id={id} className="w-16 shrink-0 text-xs font-semibold tracking-wide uppercase">
      {title}
    </h3>
  );

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-muted-foreground text-xs">{t('control.sounds.hint')}</p>

      {/* All of the projection's sound at once (#150): each channel keeps its setting. */}
      <label className="flex items-center gap-3 rounded-md border px-3 py-2">
        <Switch
          checked={!sounds.muted}
          onCheckedChange={(on) => onChange({ muted: !on })}
          aria-label={t('control.sounds.roomSound')}
        />
        <span className="flex flex-col">
          <span className="font-semibold">{t('control.sounds.roomSound')}</span>
          <span className="text-muted-foreground text-xs">
            {sounds.muted ? t('control.sounds.roomMutedHint') : t('control.sounds.roomSoundHint')}
          </span>
        </span>
      </label>

      <section className="flex flex-col gap-2" aria-labelledby="room-media">
        <div className="flex items-center gap-3">
          {heading('room-media', t('control.sounds.media'))}
          {level(t('control.sounds.mediaLevel'), sounds.mediaLevel, 'mediaLevel', 'mediaMuted')}
        </div>
        <p className="text-muted-foreground -mt-1 text-xs">{t('control.sounds.mediaWhen')}</p>
      </section>

      <section className="flex flex-col gap-2 border-t pt-3" aria-labelledby="room-music">
        <div className="flex items-center gap-3">
          {heading('room-music', t('control.sounds.music'))}
          {level(t('control.sounds.musicLevel'), sounds.musicLevel, 'musicLevel', 'musicMuted')}
        </div>
        <p className="text-muted-foreground -mt-1 text-xs">{t('control.sounds.musicWhen')}</p>
        {picker(
          t('control.sounds.musicLabel'),
          sounds.musicUrl,
          t('control.sounds.noMusic'),
          'musicId',
        )}
      </section>
      <section className="flex flex-col gap-2 border-t pt-3" aria-labelledby="room-sfx">
        <div className="flex items-center gap-3">
          {heading('room-sfx', t('control.sounds.effects'))}
          {level(t('control.sounds.sfxLevel'), sounds.sfxLevel, 'sfxLevel', 'sfxMuted')}
        </div>
        {/* One line an effect, in the order the game plays them, when it plays under it;
            its sound stays in place while it is off (greyed), so nothing jumps. */}
        <div className="grid grid-cols-[auto_7.5rem_auto_minmax(0,1fr)] items-start gap-x-2 gap-y-2">
          {effects.map((e) => (
            <Fragment key={e.on}>
              <Switch
                className="mt-1.5"
                checked={sounds[e.on]}
                onCheckedChange={(v) => onChange({ [e.on]: v })}
                aria-label={t(`control.sounds.${e.on}Label`)}
              />
              <span className={cn('pt-1.5 font-medium', !sounds[e.on] && 'text-muted-foreground')}>
                {t(`control.sounds.${e.on}`)}
              </span>
              {/* Heard here only: the room does not. */}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={t('control.sounds.preview', { name: t(`control.sounds.${e.on}`) })}
                title={t('control.sounds.preview', { name: t(`control.sounds.${e.on}`) })}
                onClick={() => void previewEffect(e.on, sounds)}
              >
                <Play className="size-4" />
              </Button>
              {picker(
                t(`control.sounds.${e.on}Label`),
                e.url,
                t('control.sounds.synth'),
                e.id,
                !sounds[e.on],
              )}
              {/* When it plays, under its line: what the host needs to choose it. */}
              <p className="text-muted-foreground col-span-3 col-start-2 -mt-1 text-xs">
                {t(`control.sounds.${e.on}When`)}
              </p>
            </Fragment>
          ))}
        </div>
      </section>
    </div>
  );
}
