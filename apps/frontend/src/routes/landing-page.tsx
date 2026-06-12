import { CONTRACTS_VERSION } from '@roux-quizz/contracts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export function LandingPage() {
  return (
    <section className="flex flex-col items-center gap-6 py-8 text-center">
      <h1 className="text-3xl font-bold">Quiz interactifs pour la formation</h1>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Rejoindre une session</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Input
              id="pin"
              inputMode="numeric"
              placeholder="PIN"
              maxLength={6}
              disabled
              className="text-center text-lg tracking-[0.3em]"
            />
            <Button type="button" disabled>
              Rejoindre
            </Button>
          </div>
          <small className="text-muted-foreground">Le gameplay arrivera en v0.3.0.</small>
        </CardContent>
      </Card>
      <small className="text-muted-foreground">contrats v{CONTRACTS_VERSION}</small>
    </section>
  );
}
