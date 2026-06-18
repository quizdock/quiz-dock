import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Pencil, Play, Plus, Radio, Square } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useLaunchSession } from '../game/use-launch-session';
import {
  getGameControllerMineQueryKey,
  useGameControllerEnd,
  useGameControllerMine,
} from '../api/generated/games/games';
import {
  getQuizzesControllerListQueryKey,
  useQuizzesControllerCreate,
  useQuizzesControllerList,
} from '../api/generated/quizzes/quizzes';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Brouillon',
  ready: 'Prêt',
  archived: 'Archivé',
};

const STATUS_VARIANT: Record<string, 'default' | 'success' | 'muted'> = {
  draft: 'default',
  ready: 'success',
  archived: 'muted',
};

export function DashboardPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuizzesControllerList();
  const create = useQuizzesControllerCreate();
  const { launch, isLaunching, error: launchError } = useLaunchSession();
  const { data: gamesData } = useGameControllerMine();
  const endGame = useGameControllerEnd();
  const [endPin, setEndPin] = useState<string | null>(null);
  const quizzes = data?.data ?? [];
  const activeGames = gamesData?.data ?? [];

  const onEndGame = (pin: string) => {
    endGame.mutate(
      { pin },
      {
        onSuccess: () =>
          queryClient.invalidateQueries({ queryKey: getGameControllerMineQueryKey() }),
      },
    );
  };

  const onCreate = () => {
    create.mutate(
      { data: { title: 'Nouveau quiz', language: 'fr' } },
      {
        onSuccess: () =>
          queryClient.invalidateQueries({
            queryKey: getQuizzesControllerListQueryKey(),
          }),
      },
    );
  };

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Mes quiz</h1>
        <Button type="button" onClick={onCreate} disabled={create.isPending}>
          <Plus className="size-4" />
          Nouveau quiz
        </Button>
      </div>

      {activeGames.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <Radio className="size-4 text-primary" />
            Parties en cours
          </h2>
          <ul className="flex flex-col gap-2">
            {activeGames.map((game) => (
              <li
                key={game.pin}
                className="flex items-center gap-4 rounded-md bg-background px-3 py-2"
              >
                <span className="flex-1 font-medium">{game.title}</span>
                <span className="font-mono tracking-widest">{game.pin}</span>
                <span className="text-sm text-muted-foreground">{game.playerCount} joueur(s)</span>
                <Link to="/present/$pin/control" params={{ pin: game.pin }}>
                  <Button type="button" size="sm" variant="outline">
                    Reprendre
                  </Button>
                </Link>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={endGame.isPending}
                  onClick={() => setEndPin(game.pin)}
                >
                  <Square className="size-4" />
                  Arrêter
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ConfirmDialog
        open={endPin !== null}
        destructive
        title="Arrêter la partie ?"
        description="La partie en cours sera définitivement terminée pour tous les joueurs connectés."
        confirmLabel="Arrêter la partie"
        onCancel={() => setEndPin(null)}
        onConfirm={() => {
          if (endPin) onEndGame(endPin);
          setEndPin(null);
        }}
      />

      {isLoading && <p className="text-muted-foreground">Chargement…</p>}
      {error ? <p className="text-destructive">Impossible de charger les quiz.</p> : null}
      {launchError ? <p className="text-destructive">{launchError}</p> : null}

      {!isLoading && !error && quizzes.length === 0 && (
        <p className="text-muted-foreground">Aucun quiz pour l’instant. Créez-en un !</p>
      )}

      <ul className="flex flex-col gap-2">
        {quizzes.map((quiz) => (
          <li
            key={quiz.id}
            className="flex items-center gap-4 rounded-lg border p-4 transition-colors hover:bg-accent"
          >
            <Link
              to="/quizzes/$quizId"
              params={{ quizId: quiz.id }}
              className="flex-1 font-semibold"
            >
              {quiz.title}
            </Link>
            <Badge variant={STATUS_VARIANT[quiz.status] ?? 'default'}>
              {STATUS_LABEL[quiz.status] ?? quiz.status}
            </Badge>
            <span className="text-sm text-muted-foreground">{quiz.questionCount} question(s)</span>
            <Link to="/quizzes/$quizId" params={{ quizId: quiz.id }}>
              <Button type="button" size="sm" variant="outline">
                <Pencil className="size-4" />
                Éditer
              </Button>
            </Link>
            {quiz.status === 'ready' && (
              <Button
                type="button"
                size="sm"
                variant="main-action"
                disabled={isLaunching}
                onClick={() => void launch(quiz.id)}
              >
                <Play className="size-4" />
                Présenter
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
