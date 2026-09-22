import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { type HostSeat, type User, UserRole } from '@prisma/client';
import { type AuthPrincipal, LOCAL_SUB_PREFIX } from '../auth/auth-provider';
import { effectiveRole } from '../auth/roles';
import { DEMO_SEAT_MINUTES, isDemoMode } from '../demo/demo.config';
import { PrismaService } from '../prisma/prisma.service';
import { SampleQuizzesService } from '../quizzes/samples/sample-quizzes.service';

/** Arbitrary app-wide advisory lock id serialising concurrent seat claims. */
const SEAT_LOCK_ID = 714_001;
const SEAT_ID = 1;

export interface HostSeatState {
  holder: string | null;
  expiresAt: Date | null;
  /** When the current holder took (or renewed) the seat; null when free. */
  claimedAt: Date | null;
}

/**
 * Local mode (`AUTH_MODE=none`) — the **host seat**. Zero configuration, but an
 * intentional act: a local user **claims** the seat explicitly (after the SPA
 * explained the lock), optionally with an auto-expiry. While held, every other
 * local identity is provisioned as `player` (may only join sessions). The seat is
 * freed on release (log out) or lazily once `expiresAt` is past — no scheduler.
 *
 * Not a security boundary: a local identity is a self-declared name, so whoever
 * types the holder's name shares their seat. Meant for trusted networks; a public
 * instance adds the `DEMO_MODE` guards on top (short seat, no uploads, reset).
 */
@Injectable()
export class HostSeatService {
  private readonly log = new Logger(HostSeatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly samples: SampleQuizzesService,
  ) {}

  static isLocal(sub: string): boolean {
    return sub.startsWith(LOCAL_SUB_PREFIX);
  }

  private static isLive(seat: HostSeat | null, now = new Date()): seat is HostSeat {
    return !!seat && (seat.expiresAt === null || seat.expiresAt > now);
  }

  /** Current state: holder's display name and expiry, or free (`holder: null`). */
  async state(): Promise<HostSeatState> {
    const seat = await this.prisma.hostSeat.findUnique({
      where: { id: SEAT_ID },
      include: { user: { select: { displayName: true } } },
    });
    if (!HostSeatService.isLive(seat)) return { holder: null, expiresAt: null, claimedAt: null };
    return { holder: seat.user.displayName, expiresAt: seat.expiresAt, claimedAt: seat.claimedAt };
  }

  /**
   * Provisions a local principal. The role is *derived* from the seat on every
   * request: `host` while this user holds a live seat, `player` otherwise — so an
   * expiry or a release takes effect immediately, and nothing is ever claimed here.
   * An operator grant (`host` or `admin`, CLI) outranks the seat and survives it.
   */
  async provision(principal: AuthPrincipal): Promise<User> {
    const [existing, seat] = await Promise.all([
      this.prisma.user.findUnique({
        where: { oidcSubject: principal.sub },
        select: { id: true, assignedRole: true },
      }),
      this.prisma.hostSeat.findUnique({ where: { id: SEAT_ID } }),
    ]);
    const isHolder = !!existing && HostSeatService.isLive(seat) && seat.userId === existing.id;
    const role = effectiveRole(
      existing?.assignedRole ?? null,
      isHolder ? UserRole.host : UserRole.player,
    );
    return this.prisma.user.upsert({
      where: { oidcSubject: principal.sub },
      create: {
        oidcSubject: principal.sub,
        displayName: principal.displayName,
        email: principal.email,
        role,
      },
      update: { displayName: principal.displayName, email: principal.email, role },
    });
  }

  /**
   * Takes the seat for `user` (or renews its expiry when already held by them).
   * Serialised by a transaction-scoped advisory lock; refused (409) while another
   * user holds a live seat. First-time claimers get the sample quizzes. On a demo
   * instance the requested expiry is ignored: the seat always lasts
   * `DEMO_SEAT_MINUTES` from now, renewal included.
   */
  async claim(user: User, requestedMinutes: number | null): Promise<HostSeatState> {
    const expiresInMinutes = isDemoMode() ? DEMO_SEAT_MINUTES : requestedMinutes;
    const claimedAt = new Date();
    const expiresAt = expiresInMinutes
      ? new Date(claimedAt.getTime() + expiresInMinutes * 60_000)
      : null;
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SEAT_LOCK_ID})`;
      const seat = await tx.hostSeat.findUnique({ where: { id: SEAT_ID } });
      if (HostSeatService.isLive(seat) && seat.userId !== user.id) {
        throw new ConflictException('host_seat.taken');
      }
      if (seat && seat.userId !== user.id) {
        // Expired seat left by someone else: demote them before taking over — back
        // to their operator grant when they have one, `player` otherwise.
        const previous = await tx.user.findUnique({
          where: { id: seat.userId },
          select: { assignedRole: true },
        });
        await tx.user.update({
          where: { id: seat.userId },
          data: { role: previous?.assignedRole ?? UserRole.player },
        });
      }
      await tx.hostSeat.upsert({
        where: { id: SEAT_ID },
        create: { id: SEAT_ID, userId: user.id, claimedAt, expiresAt },
        update: { userId: user.id, claimedAt, expiresAt },
      });
      await tx.user.update({
        where: { id: user.id },
        data: { role: effectiveRole(user.assignedRole, UserRole.host) },
      });
    });
    this.log.log(
      `Host seat claimed by "${user.displayName}" (${user.oidcSubject}), expires ${expiresAt?.toISOString() ?? 'never'}`,
    );
    await this.samples.createIfEmpty(user.id);
    return { holder: user.displayName, expiresAt, claimedAt };
  }

  /**
   * Shortens a live seat to at most `minutes` from now (demo instance starting
   * over a seat taken before the guard existed). Returns whether a seat was cut.
   */
  async capExpiry(minutes: number): Promise<boolean> {
    const now = new Date();
    const cap = new Date(now.getTime() + minutes * 60_000);
    const res = await this.prisma.hostSeat.updateMany({
      where: { id: SEAT_ID, OR: [{ expiresAt: null }, { expiresAt: { gt: cap } }] },
      data: { expiresAt: cap },
    });
    if (res.count > 0) this.log.log(`Host seat capped to ${minutes} min`);
    return res.count > 0;
  }

  /** Full seat row with its holder (operator tooling), or `null` when no row. */
  details(): Promise<(HostSeat & { user: Pick<User, 'displayName' | 'oidcSubject'> }) | null> {
    return this.prisma.hostSeat.findUnique({
      where: { id: SEAT_ID },
      include: { user: { select: { displayName: true, oidcSubject: true } } },
    });
  }

  /** Operator override: frees the seat whoever holds it (admin CLI). */
  async forceRelease(): Promise<boolean> {
    const seat = await this.prisma.hostSeat.findUnique({
      where: { id: SEAT_ID },
      include: { user: { select: { assignedRole: true } } },
    });
    if (!seat) return false;
    await this.prisma.$transaction([
      this.prisma.hostSeat.delete({ where: { id: SEAT_ID } }),
      this.prisma.user.update({
        where: { id: seat.userId },
        data: { role: seat.user.assignedRole ?? UserRole.player },
      }),
    ]);
    this.log.log('Host seat force-released by an operator');
    return true;
  }

  /** Releases the seat if `user` holds it. Returns whether anything changed. */
  async release(user: User): Promise<boolean> {
    if (!HostSeatService.isLocal(user.oidcSubject)) return false;
    const res = await this.prisma.hostSeat.deleteMany({ where: { id: SEAT_ID, userId: user.id } });
    if (res.count > 0) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { role: user.assignedRole ?? UserRole.player },
      });
      this.log.log(`Host seat released by ${user.oidcSubject}`);
    }
    return res.count > 0;
  }
}
