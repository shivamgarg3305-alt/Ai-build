import { Hono } from 'hono';
import {
  assistantIdentityResponseSchema,
  createPreferenceRequestSchema,
  instructionPreviewRequestSchema,
  PREFERENCE_MAX_COUNT,
  respondRequestSchema,
  updatePersonalityRequestSchema,
  type AssistantIdentityResponse,
  type InstructionPreviewResponse,
  type PersonalityResponse,
} from '@assistant/shared';
import type { AppEnv } from '../../app-env';
import { recordAudit } from '../../auth/audit';
import { BEHAVIOR_RULES, CONSTITUTION_VERSION, PRECEDENCE_RULES, PRINCIPLES } from '../../assistant/constitution';
import { getCoreLayers } from '../../assistant/core';
import { screenInstruction } from '../../assistant/guard';
import { IDENTITY_DECLARATION, IDENTITY_VERSION } from '../../assistant/identity';
import { LAYER_ORDER } from '../../assistant/layers';
import { ensureInstructionRevisions, listRevisions } from '../../assistant/ledger';
import { ADDRESS_TERM, COMMUNICATION_RULES, PERSONALITY_VERSION, TRAITS } from '../../assistant/personality';
import { getAiStatus, respond } from '../../assistant/respond';
import { loadAssembly } from '../../assistant/service';
import {
  addPreference,
  countPreferences,
  getPersonalitySettings,
  listPreferences,
  removePreference,
  savePersonalitySettings,
} from '../../assistant/store';
import { AppError } from '../../errors';
import { requireAuth } from '../../middleware/require-auth';
import { parseJson } from '../../middleware/validate';
import type { Services } from '../../services';

function userIdOf(c: { get(key: 'auth'): { userId: string } | undefined }): string {
  const auth = c.get('auth');
  if (!auth) throw AppError.unauthorized();
  return auth.userId;
}

export function assistantRoutes(services: Services) {
  const { db } = services;
  const routes = new Hono<AppEnv>();

  routes.use('*', requireAuth(services));
  routes.use('*', async (_c, next) => {
    await ensureInstructionRevisions(db);
    await next();
  });

  // Read-only view of the permanent layers, the adjustable setting, and the revision ledger.
  routes.get('/identity', async (c) => {
    const userId = userIdOf(c);
    const core = await getCoreLayers();
    const hashOf = (id: 'identity' | 'constitution' | 'personality') => core.find((l) => l.id === id)?.hash ?? '';
    const { settings, revision } = await getPersonalitySettings(db, userId);
    const body: AssistantIdentityResponse = assistantIdentityResponseSchema.parse({
      identity: { version: IDENTITY_VERSION, sha256: hashOf('identity'), declaration: IDENTITY_DECLARATION },
      constitution: {
        version: CONSTITUTION_VERSION,
        sha256: hashOf('constitution'),
        principles: PRINCIPLES,
        behaviorRules: BEHAVIOR_RULES,
        precedence: PRECEDENCE_RULES,
      },
      personality: {
        version: PERSONALITY_VERSION,
        sha256: hashOf('personality'),
        addressTerm: ADDRESS_TERM,
        traits: TRAITS,
        communicationRules: COMMUNICATION_RULES,
        settings,
        settingsRevision: revision,
      },
      layerOrder: LAYER_ORDER,
      revisions: await listRevisions(db),
    });
    return c.json(body);
  });

  routes.get('/personality', async (c) => {
    const body: PersonalityResponse = await getPersonalitySettings(db, userIdOf(c));
    return c.json(body);
  });

  routes.put('/personality', async (c) => {
    const userId = userIdOf(c);
    const input = await parseJson(c, updatePersonalityRequestSchema);
    const now = new Date();
    const revision = await savePersonalitySettings(db, userId, { proactivity: input.proactivity }, now);
    await recordAudit(db, { userId, event: 'assistant.personality_updated', metadata: { proactivity: input.proactivity, revision } }, now);
    const body: PersonalityResponse = { settings: { proactivity: input.proactivity }, revision };
    return c.json(body);
  });

  routes.get('/preferences', async (c) => c.json({ preferences: await listPreferences(db, userIdOf(c)) }));

  routes.post('/preferences', async (c) => {
    const userId = userIdOf(c);
    const { text } = await parseJson(c, createPreferenceRequestSchema);
    const screened = screenInstruction(text);
    if (!screened.ok) {
      throw new AppError(
        422,
        'instruction_conflict',
        `This preference was not saved. ${screened.reason} It conflicts with the assistant's permanent ${screened.protects.replace(/_/g, ' ')}.`,
        { ruleId: screened.ruleId, protects: screened.protects },
      );
    }
    if ((await countPreferences(db, userId)) >= PREFERENCE_MAX_COUNT) {
      throw new AppError(409, 'preference_limit_reached', `At most ${PREFERENCE_MAX_COUNT} preferences can be stored.`);
    }
    const now = new Date();
    const preference = await addPreference(db, userId, text, now);
    await recordAudit(db, { userId, event: 'assistant.preference_added', entityType: 'user_preference', entityId: preference.id }, now);
    return c.json({ preference }, 201);
  });

  routes.delete('/preferences/:id', async (c) => {
    const userId = userIdOf(c);
    const id = c.req.param('id');
    if (!(await removePreference(db, userId, id))) throw AppError.notFound('Preference not found.');
    await recordAudit(db, { userId, event: 'assistant.preference_removed', entityType: 'user_preference', entityId: id }, new Date());
    return c.body(null, 204);
  });

  // Shows exactly what would be sent to a model as the system instruction, and what was refused.
  routes.post('/instructions/preview', async (c) => {
    const input = await parseJson(c, instructionPreviewRequestSchema);
    const assembly = await loadAssembly(db, userIdOf(c), input);
    const body: InstructionPreviewResponse = {
      instruction: assembly.text,
      layers: assembly.layers,
      rejected: assembly.rejected,
      permanentFingerprint: assembly.permanentFingerprint,
      fingerprint: assembly.fingerprint,
      settings: assembly.settings,
    };
    return c.json(body);
  });

  // Provider readiness and usage. Calls no provider, so it never consumes quota.
  routes.get('/ai/status', async (c) => c.json(await getAiStatus(services)));

  // The conversation engine. The client supplies ONLY user/assistant messages; the system instruction is
  // always built server-side by the Phase 2 pipeline, and provider/model/credentials are never client input.
  routes.post('/respond', async (c) => {
    const input = await parseJson(c, respondRequestSchema);
    const body = await respond(
      { services, userId: userIdOf(c), requestId: c.get('requestId'), signal: c.req.raw.signal },
      { messages: input.messages },
    );
    c.header('cache-control', 'no-store');
    return c.json(body);
  });

  return routes;
}
