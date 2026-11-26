import type { Logger } from './logger';

export interface AuthContext {
  sessionId: string;
  userId: string;
}

/** Typed per-request variables available through c.get(...). */
export type AppEnv = {
  Variables: {
    requestId: string;
    logger: Logger;
    auth?: AuthContext;
  };
};
