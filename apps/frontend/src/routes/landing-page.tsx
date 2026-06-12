import { CONTRACTS_VERSION } from '@roux-quizz/contracts';

export function LandingPage() {
  return (
    <section className="landing">
      <h1>Quiz interactifs pour la formation</h1>
      <div className="join">
        <label htmlFor="pin">Rejoindre une session</label>
        <div className="join-row">
          <input id="pin" inputMode="numeric" placeholder="PIN" maxLength={6} disabled />
          <button type="button" disabled>
            Rejoindre
          </button>
        </div>
        <small>Le gameplay arrivera en v0.3.0.</small>
      </div>
      <footer>
        <small>contrats v{CONTRACTS_VERSION}</small>
      </footer>
    </section>
  );
}
