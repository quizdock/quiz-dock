import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotFoundException } from '@nestjs/common';
import { AppConfigController } from '../../app-config/app-config.controller';
import { authMode, allowsAnonymousParticipants } from '../../auth/auth-mode';
import { AuthConfigController } from '../../auth/auth-config.controller';
import { HostSeatController } from '../../auth/host-seat.controller';
import { oidcSettings } from '../../auth/oidc/oidc-client';
import { contentSecurityPolicy } from '../../common/csp';
import { instanceLanguage } from '../../common/instance-language';
import { isDemoMode } from '../../demo/demo.config';
import { GameController } from '../../game/game.controller';
import {
  ALL_ANSWERED_DELAY_MS,
  AUTO_ADVANCE_MS,
  HOST_GRACE_MS,
  HOST_RECONNECT_WINDOW_MS,
  MEDIA_WAIT_S,
  READ_DELAY_MS,
  gameSetting,
} from '../../game/game.keys';
import { liveMotionDefault } from '../../game/live-motion';
import { HealthController } from '../../health/health.controller';
import { MediaLibraryService } from '../../media/media-library.service';
import { mediaLimits, uploadCeiling } from '../../media/media.config';
import { MediaService } from '../../media/media.service';
import { PrismaService } from '../../prisma/prisma.service';
import { publicationMaxBytes } from '../../quizzes/portable/quiz-publication.service';
import { samplesDir } from '../../quizzes/samples/samples';
import { communityHosts, communityRegistries } from '../../store/community/community-config';
import { StoreService } from '../../store/store.service';

/**
 * Characterization of the environment as the backend reads it today, before the
 * settings registry takes it over (administration spec, lot 1). Each case pins
 * what a variable gives — unset, empty, valid, odd — through the code that
 * reads it, oddities included: the refactor must keep these green, and a
 * behaviour it changes on purpose changes its case here, in a commit of its own.
 *
 * Not reachable from a unit test, pinned by reading instead: `PORT` (main.ts,
 * `Number(PORT ?? 3000)`), `CLIENT_DIR` at module load (app.module.ts, serves
 * the SPA when set), `OIDC_SESSION_SCOPE` (auth.module.ts, a warning only),
 * `REDIS_URL` (redis.service.ts, `redis://localhost:16379` when unset; the
 * client connects as soon as it is built).
 * `TRUST_PROXY` is pinned in trust-proxy.spec.ts, `qd doctor`'s own reads in
 * the CLI's spec.
 */

const MB = 1024 * 1024;
let original: NodeJS.ProcessEnv;

beforeEach(() => {
  original = process.env;
  process.env = { ...original };
});

afterEach(() => {
  process.env = original;
});

/** Sets (or, with `undefined`, removes) environment variables for one case. */
function setEnv(vars: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

/** Re-imports a module, for the values it reads once when it loads. */
function loadFresh<T extends object>(path: string): T {
  let mod!: T;
  jest.isolateModules(() => {
    mod = jest.requireActual<T>(path);
  });
  return mod;
}

describe('Identity & branding', () => {
  const configJs = () => {
    const js = new AppConfigController().configJs();
    return JSON.parse(js.replace(/^window\.__APP_CONFIG__ = /, '').replace(/;\n$/, '')) as Record<
      string,
      unknown
    >;
  };

  beforeEach(() =>
    setEnv({
      APP_NAME: undefined,
      APP_LANG: undefined,
      APP_LOGO_URL: undefined,
      APP_FEEDBACK_URL: undefined,
      LIVE_MOTION: undefined,
    }),
  );

  it('config.js carries the defaults when nothing is set', () => {
    expect(configJs()).toEqual({
      appName: 'QuizDock',
      lang: 'en',
      logoUrl: '',
      feedbackUrl: '',
      liveMotion: true,
    });
  });

  it('config.js carries the values as written, unchecked', () => {
    setEnv({
      APP_NAME: 'Quiz "du" lundi',
      APP_LANG: 'xx',
      APP_LOGO_URL: 'not a url',
      APP_FEEDBACK_URL: 'none',
    });
    expect(configJs()).toMatchObject({
      appName: 'Quiz "du" lundi',
      lang: 'xx',
      logoUrl: 'not a url',
      feedbackUrl: 'none',
    });
  });

  it('APP_NAME empty stays empty, APP_LANG empty falls back to en', () => {
    setEnv({ APP_NAME: '', APP_LANG: '' });
    expect(configJs()).toMatchObject({ appName: '', lang: 'en' });
    expect(instanceLanguage()).toBe('en');
  });

  it('APP_NAME and APP_LANG rename the manifest; without CLIENT_DIR there is none', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qd-client-'));
    writeFileSync(
      join(dir, 'manifest.webmanifest'),
      JSON.stringify({ name: 'x', display: 'standalone' }),
    );
    setEnv({ CLIENT_DIR: dir, APP_NAME: 'Salle B', APP_LANG: 'fr' });
    expect(JSON.parse(await new AppConfigController().manifest())).toEqual({
      name: 'Salle B',
      short_name: 'Salle B',
      lang: 'fr',
      display: 'standalone',
    });
    setEnv({ APP_NAME: undefined });
    expect(JSON.parse(await new AppConfigController().manifest())).toMatchObject({
      name: 'QuizDock',
    });
    setEnv({ CLIENT_DIR: undefined });
    await expect(new AppConfigController().manifest()).rejects.toBeInstanceOf(NotFoundException);
  });

  it('APP_LOGO_URL adds its origin to the CSP images, an unreadable one adds nothing', () => {
    const imgSrc = (url?: string) =>
      contentSecurityPolicy({ APP_LOGO_URL: url })
        .split('; ')
        .find((d) => d.startsWith('img-src'));
    expect(imgSrc()).toBe("img-src 'self' data: blob: https:");
    expect(imgSrc('https://cdn.example.org/logo.png')).toBe(
      "img-src 'self' data: blob: https: https://cdn.example.org",
    );
    expect(imgSrc('not a url')).toBe("img-src 'self' data: blob: https:");
  });
});

describe('Access & authentication', () => {
  beforeEach(() =>
    setEnv({
      AUTH_MODE: undefined,
      DEMO_MODE: undefined,
      ALLOW_ANONYMOUS_PARTICIPANTS: undefined,
      QUIZDOCK_FLAVOR: undefined,
      QUIZ_STORE_URL: undefined,
    }),
  );

  it.each([
    [undefined, 'none'],
    ['', 'none'],
    ['oidc', 'oidc'],
    ['OIDC', 'none'],
    [' oidc', 'none'],
    ['keycloak', 'none'],
  ])('AUTH_MODE=%p is the %s mode', (value, mode) => {
    setEnv({ AUTH_MODE: value });
    expect(authMode()).toBe(mode);
  });

  it('the health probe reports AUTH_MODE as written, none when unset', () => {
    const health = () => new HealthController().check().authMode;
    expect(health()).toBe('none');
    setEnv({ AUTH_MODE: 'OIDC' });
    expect(health()).toBe('OIDC');
    setEnv({ AUTH_MODE: '' });
    expect(health()).toBe('');
  });

  it('the host seat is empty under AUTH_MODE=oidc exactly, without reading it', async () => {
    const seat = {
      state: jest.fn().mockResolvedValue({ holder: null, expiresAt: null, claimedAt: null }),
    };
    setEnv({ AUTH_MODE: 'oidc' });
    await new HostSeatController(seat as never).state();
    expect(seat.state).not.toHaveBeenCalled();
    setEnv({ AUTH_MODE: 'OIDC' });
    await new HostSeatController(seat as never).state();
    expect(seat.state).toHaveBeenCalled();
  });

  it.each([
    ['true', true],
    ['TRUE', false],
    ['1', false],
    ['', false],
    [undefined, false],
  ])('DEMO_MODE=%p is demo: %p', (value, demo) => {
    setEnv({ DEMO_MODE: value });
    expect(isDemoMode()).toBe(demo);
  });

  it.each([
    ['oidc', 'true', true],
    ['oidc', 'TRUE', false],
    ['oidc', undefined, false],
    ['none', 'true', false],
    [undefined, 'true', false],
  ])('AUTH_MODE=%p, ALLOW_ANONYMOUS_PARTICIPANTS=%p: anonymous %p', (mode, allow, anonymous) => {
    setEnv({ AUTH_MODE: mode, ALLOW_ANONYMOUS_PARTICIPANTS: allow });
    expect(allowsAnonymousParticipants()).toBe(anonymous);
  });

  it('the auth config says standalone for QUIZDOCK_FLAVOR=standalone exactly', () => {
    const standalone = () => new AuthConfigController().config().standalone;
    expect(standalone()).toBe(false);
    setEnv({ QUIZDOCK_FLAVOR: 'standalone' });
    expect(standalone()).toBe(true);
    setEnv({ QUIZDOCK_FLAVOR: 'Standalone' });
    expect(standalone()).toBe(false);
  });

  describe('OIDC', () => {
    const issuer = 'https://id.example.org/realms/quiz';

    it('defaults around a bare issuer', () => {
      expect(oidcSettings({ OIDC_ISSUER: issuer })).toEqual({
        issuer,
        clientId: 'quiz-dock-frontend',
        clientSecret: null,
        audience: null,
        internalUrl: null,
        jwksUri: null,
        scope: 'openid profile email',
      });
    });

    it('empty values count as unset', () => {
      expect(
        oidcSettings({
          OIDC_ISSUER: issuer,
          OIDC_CLIENT_ID: '',
          OIDC_CLIENT_SECRET: '',
          OIDC_AUDIENCE: '',
          OIDC_JWKS_URI: '',
          OIDC_INTERNAL_URL: '',
        }),
      ).toMatchObject({
        clientId: 'quiz-dock-frontend',
        clientSecret: null,
        audience: null,
        jwksUri: null,
      });
    });

    it('OIDC_ISSUER is required, a URL, http(s), without query or fragment; trimmed', () => {
      expect(() => oidcSettings({})).toThrow('OIDC_ISSUER is required');
      expect(() => oidcSettings({ OIDC_ISSUER: '  ' })).toThrow('OIDC_ISSUER is required');
      expect(() => oidcSettings({ OIDC_ISSUER: 'id.example.org' })).toThrow('is not a URL');
      expect(() => oidcSettings({ OIDC_ISSUER: 'ftp://id.example.org' })).toThrow('http(s) URL');
      expect(() => oidcSettings({ OIDC_ISSUER: `${issuer}?x=1` })).toThrow('http(s) URL');
      expect(oidcSettings({ OIDC_ISSUER: ` ${issuer} ` }).issuer).toBe(issuer);
    });

    it('OIDC_INTERNAL_URL is kept as an origin, else derived from a JWKS URI elsewhere', () => {
      expect(
        oidcSettings({ OIDC_ISSUER: issuer, OIDC_INTERNAL_URL: 'http://keycloak:8080/some/path' })
          .internalUrl,
      ).toBe('http://keycloak:8080');
      expect(
        oidcSettings({
          OIDC_ISSUER: issuer,
          OIDC_JWKS_URI: 'http://keycloak:8080/realms/quiz/certs',
        }),
      ).toMatchObject({
        internalUrl: 'http://keycloak:8080',
        jwksUri: 'http://keycloak:8080/realms/quiz/certs',
      });
      expect(
        oidcSettings({
          OIDC_ISSUER: issuer,
          OIDC_JWKS_URI: 'https://id.example.org/realms/quiz/certs',
        }).internalUrl,
      ).toBeNull();
    });
  });
});

describe('Network & invitation', () => {
  const addresses = () => new GameController({} as never, {} as never).joinAddresses();

  beforeEach(() => setEnv({ APP_PUBLIC_URL: undefined, HOST_LAN_IPS: undefined }));

  it('APP_PUBLIC_URL is trimmed and loses its trailing slashes; empty is none', () => {
    setEnv({ HOST_LAN_IPS: '10.0.0.2' });
    expect(addresses().publicUrl).toBeNull();
    setEnv({ APP_PUBLIC_URL: '  https://quiz.example.org/// ' });
    expect(addresses().publicUrl).toBe('https://quiz.example.org');
    setEnv({ APP_PUBLIC_URL: 'quiz.example.org/path/' });
    expect(addresses().publicUrl).toBe('quiz.example.org/path');
  });

  it('HOST_LAN_IPS is split on commas, trimmed, deduplicated, unchecked', () => {
    setEnv({ HOST_LAN_IPS: ' 10.0.0.2, 10.0.0.2,,not-an-ip ' });
    expect(addresses()).toEqual({
      publicUrl: null,
      lanIps: ['10.0.0.2', 'not-an-ip'],
      lanSource: 'configured',
    });
  });

  it('HOST_LAN_IPS unset or blank: the interfaces are read instead', () => {
    expect(addresses().lanSource).not.toBe('configured');
    setEnv({ HOST_LAN_IPS: ' , ' });
    expect(addresses().lanSource).not.toBe('configured');
  });
});

describe('Storage', () => {
  beforeEach(() => setEnv({ MEDIA_DIR: undefined, STORE_DIR: undefined, SAMPLES_DIR: undefined }));

  const mediaDir = () =>
    (new MediaService({} as never, {} as never) as unknown as { dir: string }).dir;
  const storeDir = () =>
    (new StoreService({} as never, {} as never) as unknown as { dir: string }).dir;

  it('defaults are relative to the working directory (the images set /data/… and /app/samples)', () => {
    expect(mediaDir()).toBe(join(process.cwd(), '.media'));
    expect(storeDir()).toBe(join(process.cwd(), '.store'));
    expect(samplesDir()).toBe(join(process.cwd(), 'samples'));
  });

  it('a set value is used as written, empty included', () => {
    setEnv({ MEDIA_DIR: '/data/media', STORE_DIR: '/data/store', SAMPLES_DIR: '/app/samples' });
    expect([mediaDir(), storeDir(), samplesDir()]).toEqual([
      '/data/media',
      '/data/store',
      '/app/samples',
    ]);
    setEnv({ MEDIA_DIR: '', STORE_DIR: '', SAMPLES_DIR: '' });
    expect([mediaDir(), storeDir(), samplesDir()]).toEqual(['', '', '']);
  });

  it('DATABASE_URL is required by the Prisma client, empty included', () => {
    setEnv({ DATABASE_URL: undefined });
    expect(() => new PrismaService()).toThrow('DATABASE_URL');
    setEnv({ DATABASE_URL: '' });
    expect(() => new PrismaService()).toThrow('DATABASE_URL');
  });

  it('PRISMA_SKIP_CONNECT=1 exactly skips the connection', async () => {
    setEnv({ DATABASE_URL: 'postgresql://nobody:x@127.0.0.1:1/none' });
    const prisma = new PrismaService();
    const connect = jest.spyOn(prisma, '$connect').mockResolvedValue();
    setEnv({ PRISMA_SKIP_CONNECT: '1' });
    await prisma.onModuleInit();
    expect(connect).not.toHaveBeenCalled();
    setEnv({ PRISMA_SKIP_CONNECT: 'true' });
    await prisma.onModuleInit();
    expect(connect).toHaveBeenCalledTimes(1);
  });
});

describe('Limits', () => {
  beforeEach(() =>
    setEnv({
      MEDIA_MAX_BYTES: undefined,
      MEDIA_MAX_VIDEO_MB: undefined,
      MEDIA_MAX_AUDIO_MB: undefined,
      IMPORT_MAX_BYTES: undefined,
      PUBLICATION_MAX_MB: undefined,
      MEDIA_LIBRARY_LINKS: undefined,
    }),
  );

  it('media limits default to 10 MB images, 50 MB videos, 10 MB audio', () => {
    expect(mediaLimits()).toEqual({ image: 10 * MB, video: 50 * MB, audio: 10 * MB });
    expect(uploadCeiling()).toBe(50 * MB);
  });

  it('MEDIA_MAX_BYTES is in bytes, the other two in megabytes, fractions kept', () => {
    setEnv({ MEDIA_MAX_BYTES: '1500', MEDIA_MAX_VIDEO_MB: '0.5', MEDIA_MAX_AUDIO_MB: '200' });
    expect(mediaLimits()).toEqual({ image: 1500, video: 0.5 * MB, audio: 200 * MB });
    expect(uploadCeiling()).toBe(200 * MB);
  });

  it.each(['0', '-5', 'abc', '', 'Infinity'])('media limit %p falls back to its default', (raw) => {
    setEnv({ MEDIA_MAX_BYTES: raw, MEDIA_MAX_VIDEO_MB: raw, MEDIA_MAX_AUDIO_MB: raw });
    expect(mediaLimits()).toEqual({ image: 10 * MB, video: 50 * MB, audio: 10 * MB });
  });

  it('media limits accept what Number() reads: spaces, exponents, hex', () => {
    setEnv({ MEDIA_MAX_BYTES: ' 0x10 ', MEDIA_MAX_VIDEO_MB: '1e1' });
    expect(mediaLimits()).toMatchObject({ image: 16, video: 10 * MB });
  });

  it.each([
    [undefined, 50 * MB],
    ['1000', 1000],
    ['', 0],
    ['-1', -1],
    ['abc', NaN],
  ])('IMPORT_MAX_BYTES=%p, read once at load, is %p — unchecked', (raw, bytes) => {
    setEnv({ IMPORT_MAX_BYTES: raw });
    const { IMPORT_MAX_BYTES } = loadFresh<typeof import('../../quizzes/portable/bundle-archive')>(
      '../../quizzes/portable/bundle-archive',
    );
    expect(IMPORT_MAX_BYTES).toBe(bytes);
  });

  it('IMPORT_MAX_BYTES changed after load is not seen', () => {
    setEnv({ IMPORT_MAX_BYTES: '1000' });
    const mod = loadFresh<typeof import('../../quizzes/portable/bundle-archive')>(
      '../../quizzes/portable/bundle-archive',
    );
    setEnv({ IMPORT_MAX_BYTES: '2000' });
    expect(mod.IMPORT_MAX_BYTES).toBe(1000);
  });

  it.each([
    [undefined, 20 * MB],
    ['5', 5 * MB],
    ['0.5', 0.5 * MB],
    ['0', 20 * MB],
    ['-3', 20 * MB],
    ['abc', 20 * MB],
    ['', 20 * MB],
  ])('PUBLICATION_MAX_MB=%p is %p bytes', (raw, bytes) => {
    setEnv({ PUBLICATION_MAX_MB: raw });
    expect(publicationMaxBytes()).toBe(bytes);
  });

  describe('MEDIA_LIBRARY_LINKS', () => {
    const links = () => new MediaLibraryService({} as never).links();
    let defaults: ReturnType<typeof links>;

    beforeEach(() => {
      jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      setEnv({ MEDIA_LIBRARY_LINKS: undefined });
      defaults = links();
    });

    it('seven libraries by default', () => {
      expect(defaults).toHaveLength(7);
      expect(defaults[0]).toEqual({
        name: 'OpenSoundLibrary',
        url: 'https://opensoundlibrary.com/',
        kinds: ['audio'],
      });
    });

    it.each([['none'], ['  none  ']])('%p: no library', (raw) => {
      setEnv({ MEDIA_LIBRARY_LINKS: raw });
      expect(links()).toEqual([]);
    });

    it.each([[''], ['   '], ['NONE'], ['garbage'], ['{"name":"x"}']])('%p: the defaults', (raw) => {
      setEnv({ MEDIA_LIBRARY_LINKS: raw });
      expect(links()).toEqual(defaults);
    });

    it('a JSON list keeps the readable entries, kinds filtered or all three', () => {
      setEnv({
        MEDIA_LIBRARY_LINKS: JSON.stringify([
          { name: 'A', url: 'https://a.example/', kinds: ['image', 'font'] },
          { name: 'B', url: 'http://b.example/' },
          { name: 'C', url: 'ftp://c.example/' },
          { url: 'https://d.example/' },
          null,
        ]),
      });
      expect(links()).toEqual([
        { name: 'A', url: 'https://a.example/', kinds: ['image'] },
        { name: 'B', url: 'http://b.example/', kinds: ['image', 'video', 'audio'] },
      ]);
    });

    it('an empty JSON list is no library', () => {
      setEnv({ MEDIA_LIBRARY_LINKS: '[]' });
      expect(links()).toEqual([]);
    });
  });
});

describe('Game pace', () => {
  it('the defaults of the engine', () => {
    expect({
      READ_DELAY_MS,
      ALL_ANSWERED_DELAY_MS,
      AUTO_ADVANCE_MS,
      MEDIA_WAIT_S,
      HOST_GRACE_MS,
      HOST_RECONNECT_WINDOW_MS,
    }).toEqual({
      READ_DELAY_MS: 3000,
      ALL_ANSWERED_DELAY_MS: 1000,
      AUTO_ADVANCE_MS: 5000,
      MEDIA_WAIT_S: 10,
      HOST_GRACE_MS: 5000,
      HOST_RECONNECT_WINDOW_MS: 120_000,
    });
  });

  it.each([
    [undefined, 3000],
    ['', 3000],
    ['  ', 3000],
    ['abc', 3000],
    ['Infinity', 3000],
    ['0', 0],
    ['-500', -500],
    [' 250 ', 250],
    ['1.5', 1.5],
    ['1e3', 1000],
    ['0x10', 16],
  ])('GAME_READ_DELAY_MS=%p reads %p — no bounds', (raw, value) => {
    setEnv({ GAME_READ_DELAY_MS: raw });
    expect(gameSetting('GAME_READ_DELAY_MS', READ_DELAY_MS)).toBe(value);
  });

  it.each([
    [undefined, true],
    ['', true],
    ['on', true],
    ['no', true],
    ['false', true],
    ['off', false],
    [' OFF ', false],
  ])('LIVE_MOTION=%p moves: %p', (raw, moves) => {
    setEnv({ LIVE_MOTION: raw });
    expect(liveMotionDefault()).toBe(moves);
  });
});

describe('Community store', () => {
  beforeEach(() => setEnv({ QUIZ_STORE_URL: undefined, QUIZ_STORE_HOSTS: undefined }));

  it('QUIZ_STORE_URL: none by default, split on commas, trimmed, five at most', () => {
    expect(communityRegistries()).toEqual([]);
    expect(new AuthConfigController().config().communityStore).toBe(false);
    setEnv({ QUIZ_STORE_URL: ' a , b,,c,d,e,f,g ' });
    expect(communityRegistries()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(new AuthConfigController().config().communityStore).toBe(true);
  });

  it('QUIZ_STORE_HOSTS: GitHub by default, lower-cased, plus each registry host', () => {
    expect([...communityHosts()]).toEqual(['github.com', 'release-assets.githubusercontent.com']);
    setEnv({
      QUIZ_STORE_HOSTS: ' CDN.example.org ,',
      QUIZ_STORE_URL: 'https://Store.example.net/x,nope',
    });
    expect([...communityHosts()]).toEqual(['cdn.example.org', 'store.example.net']);
    setEnv({ QUIZ_STORE_HOSTS: '' });
    expect([...communityHosts([])]).toEqual([]);
  });
});
