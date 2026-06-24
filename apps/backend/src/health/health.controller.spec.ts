import { Test } from '@nestjs/testing';
import { CONTRACTS_VERSION } from '@quiz-dock/contracts';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();
    controller = moduleRef.get(HealthController);
  });

  it('renvoie un statut ok', () => {
    const result = controller.check();
    expect(result.status).toBe('ok');
    expect(result.service).toBe('quiz-dock-backend');
  });

  it('expose la version du contrat partagé', () => {
    expect(controller.check().contracts).toBe(CONTRACTS_VERSION);
  });

  it("reflète AUTH_MODE par défaut 'none'", () => {
    delete process.env.AUTH_MODE;
    expect(controller.check().authMode).toBe('none');
  });
});
