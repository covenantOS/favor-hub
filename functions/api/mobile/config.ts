import { mobile } from '../../_lib/mobile/route';

// Minimum app version and feature switches (mobile-v1.yaml, config). Lets the hub retire an old build.
export const onRequestGet = mobile(async ({ env }) => ({
  min_version: (env.MOBILE_MIN_VERSION || '0.1.0').trim(),
  features: { today: true, partners: true, log_contact: true, capture: !!env.MOBILE_CAPTURES },
}), { noGate: true });
