import { CircleHelp, Globe } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useGameControllerJoinAddresses } from '../api/generated/games/games';

const STORAGE_KEY = 'live.joinBaseUrl';
const CUSTOM = '__custom__';

/**
 * Lobby control: the address the invitations (QR code, link) point at.
 * Candidates: the deployment's public URL when configured, the machine's LAN
 * addresses (a local instance), this page's origin, or anything typed. The
 * choice is sent to the session (every screen follows) and remembered on this
 * browser for the next session.
 */
export function JoinAddressPicker({
  current,
  onChange,
}: {
  current: string;
  onChange: (baseUrl: string) => void;
}) {
  const { t } = useTranslation('live');
  const { data } = useGameControllerJoinAddresses();
  const origin = window.location.origin;
  const port = window.location.port ? `:${window.location.port}` : '';
  const secure = window.location.protocol === 'https:';
  // LAN candidates take this page's scheme and port: that is how the app is reached.
  const lan = useMemo(
    () => (data?.data.lanIps ?? []).map((ip) => `${window.location.protocol}//${ip}${port}`),
    [data, port],
  );
  const candidates = useMemo(() => {
    const list = [data?.data.publicUrl, ...lan, origin].filter((x): x is string => Boolean(x));
    return [...new Set(list)];
  }, [data, lan, origin]);
  const onLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(origin);
  const lanSource = data?.data.lanSource;
  const [custom, setCustom] = useState('');
  // Help stays folded until asked for: the lobby shows the invitation first.
  const [showHelp, setHelp] = useState(false);
  const isCustom = !candidates.includes(current);

  // First time on this session: apply the remembered choice, else the best candidate
  // (public URL, then a LAN address when the console runs on localhost).
  const [initialised, setInitialised] = useState(false);
  useEffect(() => {
    if (initialised || !data) return;
    setInitialised(true);
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(STORAGE_KEY);
    } catch {
      /* storage unavailable */
    }
    // A server install keeps the address the browser resolved through the reverse
    // proxy (this page's origin) — or APP_PUBLIC_URL when set. A remembered address
    // and the LAN candidates only step in on localhost, where the origin is useless.
    const preferred = data.data.publicUrl ?? (onLocalhost ? (remembered ?? lan[0] ?? null) : null);
    if (preferred && preferred !== current) onChange(preferred);
  }, [data, initialised, current, onLocalhost, lan, onChange]);

  const choose = (baseUrl: string) => onChange(baseUrl);
  // Remember what the session settled on (normalised by the server) for the next one.
  useEffect(() => {
    if (!initialised) return;
    try {
      localStorage.setItem(STORAGE_KEY, current);
    } catch {
      /* storage unavailable */
    }
  }, [current, initialised]);

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Globe className="text-muted-foreground size-4" />
        <label className="text-muted-foreground" htmlFor="join-address">
          {t('control.joinAddress')}
        </label>
        <Select
          id="join-address"
          className="h-8 w-auto min-w-[14rem] text-sm"
          value={isCustom ? CUSTOM : current}
          onChange={(e) => {
            if (e.target.value === CUSTOM) setCustom(current);
            else choose(e.target.value);
          }}
        >
          {candidates.map((c) => (
            <option key={c} value={c}>
              {c}
              {c === data?.data.publicUrl ? ` — ${t('control.joinAddressPublic')}` : ''}
              {c === origin ? ` — ${t('control.joinAddressThisPage')}` : ''}
            </option>
          ))}
          <option value={CUSTOM}>{t('control.joinAddressCustom')}</option>
        </Select>
        {isCustom || custom ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (custom.trim()) choose(custom.trim());
            }}
          >
            <Input
              className="h-8 w-56 text-sm"
              placeholder="https://quiz.example.org"
              value={custom || (isCustom ? current : '')}
              onChange={(e) => setCustom(e.target.value)}
              aria-label={t('control.joinAddressCustom')}
            />
            <Button type="submit" size="sm" variant="outline" className="h-8">
              {t('control.joinAddressApply')}
            </Button>
          </form>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={t('control.joinAddressHelpToggle')}
          aria-expanded={showHelp}
          onClick={() => setHelp(!showHelp)}
        >
          <CircleHelp className="size-4" />
        </Button>
      </div>
      {showHelp ? (
        // Why the address matters and where to find it — worded for the situation
        // this instance runs in (the one thing that goes wrong locally is inviting
        // phones to "localhost").
        <div className="bg-muted/50 text-muted-foreground flex flex-col gap-2 rounded-md border px-3 py-2 text-xs leading-relaxed">
          <p>{t('control.joinAddressHelp.why')}</p>
          {data?.data.publicUrl ? (
            <p>{t('control.joinAddressHelp.publicConfigured', { url: data.data.publicUrl })}</p>
          ) : null}
          {lanSource === 'detected' || lanSource === 'configured' ? (
            <p>{t('control.joinAddressHelp.lanKnown')}</p>
          ) : null}
          {lanSource === 'hidden' ? (
            <>
              <p>{t('control.joinAddressHelp.lanHidden')}</p>
              <p>
                <strong className="text-foreground">
                  {t('control.joinAddressHelp.whereTitle')}
                </strong>{' '}
                {t('control.joinAddressHelp.where', { port })}
              </p>
              <ul className="list-disc pl-4">
                <li>{t('control.joinAddressHelp.mac')}</li>
                <li>{t('control.joinAddressHelp.windows')}</li>
                <li>{t('control.joinAddressHelp.linux')}</li>
              </ul>
            </>
          ) : null}
          <p>{t('control.joinAddressHelp.sameNetwork')}</p>
          {secure ? <p>{t('control.joinAddressHelp.https')}</p> : null}
          {!data?.data.publicUrl ? <p>{t('control.joinAddressHelp.deployed')}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
