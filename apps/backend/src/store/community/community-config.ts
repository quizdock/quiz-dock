import { SETTINGS } from '@quiz-dock/contracts';
import { settings } from '../../admin/settings/settings.service';

export function communityRegistries(): string[] {
  return settings.get(SETTINGS.QUIZ_STORE_URL).slice(0, 5);
}
export function communityHosts(registries = communityRegistries()): Set<string> {
  const hosts = new Set(settings.get(SETTINGS.QUIZ_STORE_HOSTS));
  for (const registry of registries) {
    try {
      hosts.add(new URL(registry).hostname.toLowerCase());
    } catch {
      /* Invalid registry is reported when listed. */
    }
  }
  return hosts;
}
