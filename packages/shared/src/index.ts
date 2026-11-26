import { z } from 'zod';

export const API_VERSION = 'v1' as const;
export const API_PREFIX = `/api/${API_VERSION}` as const;

// ---- Errors ---------------------------------------------------------------
export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

// ---- Health ---------------------------------------------------------------
export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  environment: z.enum(['development', 'test', 'production']),
  time: z.string(),
  checks: z.object({
    database: z.object({
      status: z.enum(['ok', 'error']),
      driver: z.enum(['sqlite', 'd1']),
      latencyMs: z.number().nonnegative(),
      schema: z.enum(['ready', 'missing', 'unknown']),
    }),
    instructions: z.object({
      status: z.enum(['ok', 'error']),
      identityVersion: z.string(),
      constitutionVersion: z.string(),
      personalityVersion: z.string(),
    }),
  }),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

// ---- Auth -----------------------------------------------------------------
export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters.')
  .max(128, 'Password must be at most 128 characters.');

export const registerRequestSchema = z.object({
  email: emailSchema,
  displayName: z.string().trim().min(1).max(80),
  password: passwordSchema,
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const publicUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  createdAt: z.string(),
});
export type PublicUser = z.infer<typeof publicUserSchema>;

export const authSessionResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
  user: publicUserSchema,
});
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;

export const meResponseSchema = z.object({ user: publicUserSchema });
export type MeResponse = z.infer<typeof meResponseSchema>;

// ---- Assistant instructions (Phase 2) --------------------------------------
export const layerIdSchema = z.enum([
  'identity',
  'constitution',
  'personality',
  'user_preferences',
  'session_context',
  'task_instructions',
]);
export type LayerId = z.infer<typeof layerIdSchema>;

export const proactivitySchema = z.enum(['reserved', 'balanced', 'active']);
export type Proactivity = z.infer<typeof proactivitySchema>;

export const personalitySettingsSchema = z.object({ proactivity: proactivitySchema.default('balanced') });
export type PersonalitySettings = z.infer<typeof personalitySettingsSchema>;
export const DEFAULT_PERSONALITY_SETTINGS: PersonalitySettings = { proactivity: 'balanced' };

export const updatePersonalityRequestSchema = z.object({ proactivity: proactivitySchema });
export const personalityResponseSchema = z.object({
  settings: personalitySettingsSchema,
  revision: z.number().int().nonnegative(),
});
export type PersonalityResponse = z.infer<typeof personalityResponseSchema>;

export const PREFERENCE_MAX_CHARS = 500;
export const PREFERENCE_MAX_COUNT = 50;
export const INSTRUCTION_ITEM_MAX_CHARS = 1000;
export const INSTRUCTION_ITEMS_MAX = 20;

export const createPreferenceRequestSchema = z.object({ text: z.string().trim().min(1).max(PREFERENCE_MAX_CHARS) });
export const preferenceSchema = z.object({ id: z.string(), text: z.string(), createdAt: z.string() });
export type Preference = z.infer<typeof preferenceSchema>;
export const preferencesResponseSchema = z.object({ preferences: z.array(preferenceSchema) });
export const preferenceResponseSchema = z.object({ preference: preferenceSchema });

export const instructionPreviewRequestSchema = z.object({
  sessionContext: z.array(z.string()).max(50).default([]),
  taskInstructions: z.array(z.string()).max(50).default([]),
});
export type InstructionPreviewRequest = z.infer<typeof instructionPreviewRequestSchema>;

export const instructionPreviewResponseSchema = z.object({
  instruction: z.string(),
  layers: z.array(
    z.object({
      id: layerIdSchema,
      number: z.number().int(),
      version: z.string().optional(),
      sha256: z.string().optional(),
      itemCount: z.number().int().optional(),
    }),
  ),
  rejected: z.array(
    z.object({
      layer: layerIdSchema,
      index: z.number().int(),
      excerpt: z.string(),
      ruleId: z.string(),
      protects: z.string(),
      reason: z.string(),
    }),
  ),
  permanentFingerprint: z.string(),
  fingerprint: z.string(),
  settings: personalitySettingsSchema,
});
export type InstructionPreviewResponse = z.infer<typeof instructionPreviewResponseSchema>;

export const assistantIdentityResponseSchema = z.object({
  identity: z.object({ version: z.string(), sha256: z.string(), declaration: z.string() }),
  constitution: z.object({
    version: z.string(),
    sha256: z.string(),
    principles: z.array(z.object({ id: z.string(), title: z.string(), statement: z.string() })),
    behaviorRules: z.array(z.object({ id: z.string(), statement: z.string() })),
    precedence: z.array(z.string()),
  }),
  personality: z.object({
    version: z.string(),
    sha256: z.string(),
    addressTerm: z.string(),
    traits: z.array(z.string()),
    communicationRules: z.array(z.string()),
    settings: personalitySettingsSchema,
    settingsRevision: z.number().int().nonnegative(),
  }),
  layerOrder: z.array(layerIdSchema),
  revisions: z.array(
    z.object({
      layer: z.enum(['identity', 'constitution', 'personality']),
      version: z.string(),
      sha256: z.string(),
      recordedAt: z.string(),
    }),
  ),
});
export type AssistantIdentityResponse = z.infer<typeof assistantIdentityResponseSchema>;

// ---- AI conversation (Phase 3) ---------------------------------------------
export const MESSAGE_MAX_CHARS = 8000;
export const CONVERSATION_MAX_MESSAGES = 200;

/** Only user and assistant messages exist at the API boundary. System text can never be submitted. */
export const conversationMessageSchema = z.strictObject({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(MESSAGE_MAX_CHARS),
});
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;

/** Strict: unknown keys (system, model, provider, temperature, apiKey, ...) are rejected, not ignored. */
export const respondRequestSchema = z.strictObject({
  messages: z
    .array(conversationMessageSchema)
    .min(1)
    .max(CONVERSATION_MAX_MESSAGES)
    .refine((messages) => messages[messages.length - 1]?.role === 'user', { message: 'The last message must be a user message.' }),
});
export type RespondRequest = z.infer<typeof respondRequestSchema>;

export const tokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});

/**
 * Everything needed to tie a reply to the exact instruction that produced it. Phase 4 should store this
 * object in `messages.metadata` next to the assistant message; the fingerprints, not the private
 * instruction text, are what is kept.
 */
export const responseTraceSchema = z.object({
  requestId: z.string(),
  timestamp: z.string(),
  provider: z.string(),
  model: z.string(),
  instruction: z.object({
    permanentFingerprint: z.string(),
    fingerprint: z.string(),
    versions: z.object({ identity: z.string(), constitution: z.string(), personality: z.string() }),
  }),
  usage: tokenUsageSchema.optional(),
});
export type ResponseTrace = z.infer<typeof responseTraceSchema>;

export const respondResponseSchema = z.object({
  message: z.object({ role: z.literal('assistant'), content: z.string() }),
  /** false when the model stopped early (for example it hit the output limit). Never shown as a finished reply. */
  complete: z.boolean(),
  finishReason: z.enum(['stop', 'length', 'other']),
  trace: responseTraceSchema,
  context: z.object({
    received: z.number().int().nonnegative(),
    sent: z.number().int().nonnegative(),
    dropped: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }),
});
export type RespondResponse = z.infer<typeof respondResponseSchema>;

export const aiStatusSchema = z.object({
  state: z.enum(['disabled', 'cooling_down', 'limit_reached', 'ready']),
  activation: z.enum(['disabled', 'missing_api_key', 'terms_not_reviewed', 'active']),
  provider: z.string(),
  model: z.string(),
  blockedUntil: z.string().nullable(),
  blockedReason: z.string().nullable(),
  usage: z.object({
    quotaDay: z.string(),
    requestsToday: z.number().int().nonnegative(),
    tokensToday: z.number().int().nonnegative(),
    requestsLastMinute: z.number().int().nonnegative(),
  }),
  limits: z.object({
    requestsPerMinute: z.number().int().positive(),
    requestsPerDay: z.number().int().positive(),
    tokensPerDay: z.number().int().positive(),
  }),
  dataNotice: z.string().nullable(),
});
export type AiStatus = z.infer<typeof aiStatusSchema>;
