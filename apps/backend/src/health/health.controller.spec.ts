import { Test } from '@nestjs/testing';
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
    expect(result.service).toBe('roux-quizz-backend');
  });

  it('expose la version du contrat partagé', () => {
    expect(controller.check().contracts).toBe('0.1.0');
  });

  it("reflète AUTH_MODE par défaut 'none'", () => {
    delete process.env.AUTH_MODE;
    expect(controller.check().authMode).toBe('none');
  });
});
