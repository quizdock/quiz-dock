import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Download, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Markdown } from '@/components/markdown';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { COLOR_BG, OPTION_BG_FALLBACK, SHAPE_GLYPH } from '@/lib/option-style';
import { getQuizzesControllerListQueryKey } from '../api/generated/quizzes/quizzes';
import {
  getStoreControllerListQueryKey,
  useStoreControllerPreview,
  useStoreControllerTake,
  useStoreControllerWithdraw,
} from '../api/generated/store/store';
import type { StorePreviewDtoItemsItem } from '../api/generated/model';
import { apiErrorText } from '../api/http';
import { useRole } from '../auth/use-role';
import { getDemo } from '../config';
import { templateRoute } from '../router';
import { TemplateSlide } from './templates-page';

/**
 * Un modèle, vu **avant** d'en prendre une copie (#39) : ce qu'il contient,
 * question par question. C'est là qu'on décide — la galerie ne fait que donner
 * envie d'ouvrir. Prendre une copie crée un brouillon dans sa propre banque ;
 * l'original n'est jamais touché par ce qu'on en fait.
 */
export function TemplatePage() {
  const { t, i18n } = useTranslation(['store', 'common']);
  const { templateId } = templateRoute.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isPending } = useStoreControllerPreview(templateId, { query: { retry: false } });
  const take = useStoreControllerTake();
  const withdraw = useStoreControllerWithdraw();
  const { isHost } = useRole();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const template = data?.data;

  const onTake = async () => {
    setError(null);
    try {
      const { data: quiz } = await take.mutateAsync({ id: templateId });
      await queryClient.invalidateQueries({ queryKey: getQuizzesControllerListQueryKey() });
      await navigate({ to: '/quizzes/$quizId', params: { quizId: quiz.id } });
    } catch (e) {
      setError(apiErrorText(e, t('takeFailed')));
    }
  };

  const onWithdraw = async () => {
    setConfirming(false);
    setError(null);
    try {
      await withdraw.mutateAsync({ id: templateId });
      await queryClient.invalidateQueries({ queryKey: getStoreControllerListQueryKey() });
      await navigate({ to: '/templates' });
    } catch (e) {
      setError(apiErrorText(e, t('withdrawFailed')));
    }
  };

  if (isPending) return <p className="text-muted-foreground">{t('common:loading')}</p>;
  if (!template) return <p className="text-destructive">{t('notFound')}</p>;

  return (
    <section className="flex flex-col gap-6">
      <Link to="/templates" className="text-muted-foreground flex w-fit items-center gap-1 text-sm">
        <ArrowLeft className="size-4" />
        {t('backToCatalogue')}
      </Link>

      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">{template.title}</h1>
        {template.description ? <p className="max-w-prose">{template.description}</p> : null}
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <Badge variant="muted">{template.language}</Badge>
          <span>{t('questionCount', { count: template.questionCount })}</span>
          {template.slideCount > 0 ? (
            <span>{t('slideCount', { count: template.slideCount })}</span>
          ) : null}
          <span>
            {t('sharedBy', {
              name: template.author.name,
              date: new Date(template.sharedAt).toLocaleDateString(i18n.language),
            })}
          </span>
          {template.license ? <span>{t('licence', { name: template.license })}</span> : null}
        </p>
        <div className="flex flex-wrap gap-2">
          {isHost ? (
            <Button type="button" onClick={() => void onTake()} disabled={take.isPending}>
              <Download className="size-4" />
              {t('take')}
            </Button>
          ) : (
            // Prendre une copie crée un quiz : sans banque, l'action n'a pas de sens.
            <p className="text-muted-foreground text-sm">{t('takeNeedsHost')}</p>
          )}
          {/* A demo catalogue is read-only. */}
          {getDemo() ? null : (
            <Button type="button" variant="outline" onClick={() => setConfirming(true)}>
              <Trash2 className="size-4" />
              {t('withdraw')}
            </Button>
          )}
        </div>
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
      </header>

      <h2 className="text-lg font-semibold">{t('whatIsInside')}</h2>
      {/* Deux colonnes, chaque élément rendu comme on le verra en séance : une
          diapositive avec son fond, une question avec ses propositions. */}
      <ul className="quiz-items">
        {template.items.map((item, index) => (
          <li key={index} className="quiz-item">
            {item.slide ? (
              // A slide is drawn as on the big screen; its number and badge sit on top.
              <article className="relative overflow-hidden rounded-lg border">
                <TemplateSlide slide={item.slide} />
                <ItemMeta item={item} />
              </article>
            ) : (
              // Une hauteur plancher commune : sans elle, une question courte et une
              // question à quatre propositions donnent une grille en dents de scie.
              <article
                className={cn(
                  'relative flex h-full min-h-48 flex-col gap-3 rounded-lg border p-4 pt-10',
                  item.kind === 'slide' && 'justify-center text-center',
                )}
                style={
                  item.gradient
                    ? {
                        backgroundImage: `linear-gradient(${item.gradient.angle}deg, ${item.gradient.colors.join(', ')})`,
                        color: 'white',
                      }
                    : undefined
                }
              >
                <ItemMeta item={item} />
                {item.text ? <Markdown className="font-medium">{item.text}</Markdown> : null}
                {item.mediaUrl ? (
                  <img
                    src={item.mediaUrl}
                    alt={item.mediaAlt ?? ''}
                    className="max-h-48 w-auto rounded-md object-contain"
                  />
                ) : null}
                {item.options.length > 0 ? (
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {item.options.map((option, i) => (
                      <li
                        key={i}
                        className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm text-white ${
                          COLOR_BG[option.color] ?? OPTION_BG_FALLBACK
                        }`}
                      >
                        <span aria-hidden>{SHAPE_GLYPH[option.shape] ?? ''}</span>
                        <span className="min-w-0 truncate">{option.text}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            )}
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={confirming}
        title={t('withdrawConfirm.title')}
        description={t('withdrawConfirm.description')}
        confirmLabel={t('withdraw')}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void onWithdraw()}
      />
    </section>
  );
}

/**
 * Numéro, type et durée tiennent dans le même coin : ce sont les méta de
 * l'élément, elles ne descendent pas dans le contenu.
 */
function ItemMeta({ item }: { item: StorePreviewDtoItemsItem }) {
  const { t } = useTranslation(['store', 'common']);
  return (
    <span className="text-muted-foreground absolute top-2 left-2 z-10 flex flex-wrap items-center gap-2 text-xs">
      <span className="quiz-item-number bg-background/80 text-foreground flex size-6 items-center justify-center rounded-full font-semibold tabular-nums" />
      <Badge variant={item.kind === 'slide' ? 'muted' : 'default'}>
        {item.kind === 'slide'
          ? t('slide')
          : t(`common:questionType.${item.type}`, item.type ?? '')}
      </Badge>
      {item.timeLimitS ? (
        <span className="bg-background/80 rounded-full px-2 py-0.5">
          {t('seconds', { count: item.timeLimitS })}
        </span>
      ) : null}
    </span>
  );
}
