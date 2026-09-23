import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Download, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  getStoreControllerListQueryKey,
  useStoreControllerList,
  useStoreControllerTake,
  useStoreControllerWithdraw,
} from '../api/generated/store/store';
import { getQuizzesControllerListQueryKey } from '../api/generated/quizzes/quizzes';
import type { StoreEntryDto } from '../api/generated/model';
import { apiErrorText } from '../api/http';
import { useRole } from '../auth/use-role';

/**
 * The catalogue of templates shared on this instance (#39). Taking one puts an
 * **independent draft** in your own bank: it is yours to rename, cut and
 * present, and nothing is ever pushed back to you afterwards.
 */
export function TemplatesPage() {
  const { t } = useTranslation(['store', 'common']);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const list = useStoreControllerList();
  // Retirer une entrée est de la modération — le métier du gestionnaire ; prendre
  // une copie crée un quiz, donc c'est celui de l'hôte (RG-14).
  const { isManager } = useRole();
  const take = useStoreControllerTake();
  const withdraw = useStoreControllerWithdraw();
  const [error, setError] = useState<string | null>(null);
  const [confirmWithdraw, setConfirmWithdraw] = useState<StoreEntryDto | null>(null);

  const entries = list.data?.data ?? [];

  const onTake = async (entry: StoreEntryDto) => {
    setError(null);
    try {
      const { data } = await take.mutateAsync({ id: entry.id });
      await queryClient.invalidateQueries({ queryKey: getQuizzesControllerListQueryKey() });
      await navigate({ to: '/quizzes/$quizId', params: { quizId: data.id } });
    } catch (e) {
      setError(apiErrorText(e, t('takeFailed')));
    }
  };

  const onWithdraw = async (entry: StoreEntryDto) => {
    setError(null);
    setConfirmWithdraw(null);
    try {
      await withdraw.mutateAsync({ id: entry.id });
      await queryClient.invalidateQueries({ queryKey: getStoreControllerListQueryKey() });
    } catch (e) {
      setError(apiErrorText(e, t('withdrawFailed')));
    }
  };

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('intro')}</p>
      </header>

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}

      {list.isPending ? <p className="text-muted-foreground">{t('common:loading')}</p> : null}

      {!list.isPending && entries.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            {t('empty')}
          </CardContent>
        </Card>
      ) : null}

      <ul className="flex flex-col gap-3">
        {entries.map((entry) => (
          <li key={entry.id}>
            <Card>
              <CardHeader className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <CardTitle className="flex-1">{entry.title}</CardTitle>
                <Badge variant="muted">{entry.language}</Badge>
                <Badge variant="default">
                  {t('questionCount', { count: entry.questionCount })}
                </Badge>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {entry.description ? <p className="text-sm">{entry.description}</p> : null}
                <p className="text-muted-foreground text-xs">
                  {t('by', { name: entry.author.name })} · {t('revision', { n: entry.revision })}
                  {entry.license ? ` · ${entry.license}` : ''}
                </p>
                <div className="flex flex-wrap gap-2">
                  {/* Prendre une copie crée un quiz : réservé aux hôtes (RG-14). */}
                  {!isManager ? (
                    <Button
                      type="button"
                      onClick={() => void onTake(entry)}
                      disabled={take.isPending}
                    >
                      <Download className="size-4" />
                      {t('take')}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setConfirmWithdraw(entry)}
                    disabled={withdraw.isPending}
                  >
                    <Trash2 className="size-4" />
                    {t('withdraw')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      {/* Withdrawing removes the catalogue entry; the copies people took are theirs. */}
      <ConfirmDialog
        open={confirmWithdraw !== null}
        title={t('withdrawConfirm.title')}
        description={t('withdrawConfirm.description')}
        confirmLabel={t('withdraw')}
        onCancel={() => setConfirmWithdraw(null)}
        onConfirm={() => confirmWithdraw && void onWithdraw(confirmWithdraw)}
      />
    </section>
  );
}
