import { CONTRACTS_VERSION } from '@roux-quizz/contracts';

export function App() {
  return (
    <main className="landing">
      <h1>Roux-Quizz</h1>
      <p>Quiz interactifs pour la formation — fondations v0.1.0</p>
      <section className="join">
        <label htmlFor="pin">Rejoindre une session</label>
        <div className="join-row">
          <input id="pin" inputMode="numeric" placeholder="PIN" maxLength={6} disabled />
          <button type="button" disabled>
            Rejoindre
          </button>
        </div>
        <small>Le gameplay arrivera en v0.3.0.</small>
      </section>
      <footer>
        <small>contrats v{CONTRACTS_VERSION}</small>
      </footer>
    </main>
  );
}
