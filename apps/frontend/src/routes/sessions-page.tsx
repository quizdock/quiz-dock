import { Link } from '@tanstack/react-router';
import { ArrowLeft, ChevronRight, Radio } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  useQuizzesControllerSessionDetail,
  useQuizzesControllerSessions,
} from '../api/generated/quizzes/quizzes';
import type { SessionListDtoSessionsItem } from '../api/generated/model';
import { sessionDetailRoute, sessionsRoute } from '../router';

const STATUS_LABEL: Record<string, string> = {
  ended: 'Terminée',
  interrupted: 'Interrompue',
  archived: 'Archivée',
  lobby: 'Lobby',
  in_progress: 'En cours',
};

function statusVariant(status: string): 'success' | 'muted' | 'default' {
  if (status === 'ended') return 'success';
  if (status === 'interrupted') return 'muted';
  return 'default';
}

/** Date + heure courtes (fr). */
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Durée d'une partie « Xm Ys » à partir des deux bornes ISO. */
function fmtDuration(startISO: string, endISO: string): string {
  const s = Math.max(
    0,
    Math.round((new Date(endISO).getTime() - new Date(startISO).getTime()) / 1000),
  );
  const m = Math.floor(s / 60);
  return m > 0 ? `${m} min ${s % 60}s` : `${s}s`;
}

const pct = (rate: number | null) => (rate === null ? '—' : `${Math.round(rate * 100)} %`);
const seconds = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`);

// ── Liste de l'historique ────────────────────────────────────────────────────
export function SessionsPage() {
  const { quizId } = sessionsRoute.useParams();
  const { data, isLoading, error } = useQuizzesControllerSessions(quizId);
  const sessions = data?.data.sessions;

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Historique des parties</h1>
        <Link
          to="/quizzes/$quizId"
          params={{ quizId }}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'ml-auto')}
        >
          <ArrowLeft className="size-4" />
          Retour à l’éditeur
        </Link>
      </header>

      {isLoading ? <p className="text-muted-foreground">Chargement…</p> : null}
      {error ? <p className="text-destructive">Historique indisponible.</p> : null}
      {sessions && sessions.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            Aucune partie archivée pour ce quiz. À la fin d’une partie, choisissez « Archiver les
            résultats » pour la retrouver ici.
          </CardContent>
        </Card>
      ) : null}

      {sessions && sessions.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {sessions.map((s) => (
            <SessionRow key={s.id} quizId={quizId} session={s} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function SessionRow({
  quizId,
  session: s,
}: {
  quizId: string;
  session: SessionListDtoSessionsItem;
}) {
  return (
    <li>
      <Link
        to="/quizzes/$quizId/sessions/$sessionId"
        params={{ quizId, sessionId: s.id }}
        className="bg-card hover:bg-accent/40 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border p-4 transition-colors"
      >
        <div className="min-w-0 flex-1">
          <p className="font-medium">{fmtDate(s.startedAt)}</p>
          <p className="text-muted-foreground text-xs">
            PIN {s.pin} · {fmtDuration(s.startedAt, s.endedAt)}
          </p>
        </div>
        <Badge variant={statusVariant(s.status)}>{STATUS_LABEL[s.status] ?? s.status}</Badge>
        {s.fullCapture ? (
          <Badge variant="default" className="gap-1">
            <Radio className="size-3" />
            Capture
          </Badge>
        ) : null}
        <div className="text-right">
          <p className="font-semibold tabular-nums">{s.playerCount} joueur(s)</p>
          <p className="text-muted-foreground text-xs">Réussite {pct(s.successRate)}</p>
        </div>
        <ChevronRight className="text-muted-foreground size-5" />
      </Link>
    </li>
  );
}

// ── Détail d'une session ─────────────────────────────────────────────────────
export function SessionDetailPage() {
  const { quizId, sessionId } = sessionDetailRoute.useParams();
  const { data, isLoading, error } = useQuizzesControllerSessionDetail(quizId, sessionId);
  const s = data?.data;

  if (isLoading) return <p className="text-muted-foreground">Chargement…</p>;
  if (error || !s) return <p className="text-destructive">Session introuvable.</p>;

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{s.quizTitle || 'Partie'}</h1>
          <p className="text-muted-foreground text-sm">
            {fmtDate(s.startedAt)} · PIN {s.pin} · {fmtDuration(s.startedAt, s.endedAt)}
          </p>
        </div>
        <Badge variant={statusVariant(s.status)}>{STATUS_LABEL[s.status] ?? s.status}</Badge>
        <Link
          to="/quizzes/$quizId/sessions"
          params={{ quizId }}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'ml-auto')}
        >
          <ArrowLeft className="size-4" />
          Historique
        </Link>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Participants" value={String(s.playerCount)} />
        <Stat label="Réussite globale" value={pct(s.successRate)} />
        <Stat label="Questions" value={String(s.totalQuestions)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Résultats par question</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground border-b text-left">
              <tr>
                <th className="py-2 pr-2 font-medium">#</th>
                <th className="py-2 pr-2 font-medium">Question</th>
                <th className="py-2 pr-2 text-right font-medium">Réponses</th>
                <th className="py-2 pr-2 text-right font-medium">Réussite</th>
                <th className="py-2 text-right font-medium">Temps moy.</th>
              </tr>
            </thead>
            <tbody>
              {s.questions.map((q) => (
                <tr key={q.orderIndex} className="border-b last:border-0">
                  <td className="py-2 pr-2 tabular-nums">{q.orderIndex + 1}</td>
                  <td className="max-w-xs truncate py-2 pr-2">{q.prompt}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{q.answerCount}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {pct(q.successRate)}{' '}
                    <span className="text-muted-foreground">({q.correctCount})</span>
                  </td>
                  <td className="py-2 text-right tabular-nums">{seconds(q.avgResponseMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Participants</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground border-b text-left">
              <tr>
                <th className="py-2 pr-2 font-medium">Rang</th>
                <th className="py-2 pr-2 font-medium">Pseudo</th>
                <th className="py-2 pr-2 text-right font-medium">Score</th>
                <th className="py-2 pr-2 text-right font-medium">Bonnes</th>
                <th className="py-2 pr-2 text-right font-medium">Série</th>
                <th className="py-2 text-right font-medium">Temps moy.</th>
              </tr>
            </thead>
            <tbody>
              {s.players.map((p) => (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="py-2 pr-2 tabular-nums">{p.finalRank}</td>
                  <td className="py-2 pr-2 font-medium">{p.nickname}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{p.finalScore}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {p.correctCount}/{p.answeredCount}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">{p.maxStreak}</td>
                  <td className="py-2 text-right tabular-nums">{seconds(p.avgResponseMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 py-4">
        <span className="text-muted-foreground text-xs uppercase tracking-wide">{label}</span>
        <span className="text-2xl font-bold tabular-nums">{value}</span>
      </CardContent>
    </Card>
  );
}
