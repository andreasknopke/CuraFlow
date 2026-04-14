import cors from 'cors';
import config from '../config.js';
import {
  buildAllowedOrigins,
  createCorsRejectionError,
  CORS_HEADERS,
  CORS_METHODS,
  isOriginAllowed,
} from './corsPolicy.js';

export const applyCors = (app) => {
  const allowedOrigins = buildAllowedOrigins(config.server);

  console.log('CORS allowed origins:', allowedOrigins);
  console.log('NODE_ENV:', config.server.nodeEnv);

  const resolveOrigin = (origin, callback) => {
    if (isOriginAllowed(origin, allowedOrigins)) {
      callback(null, true);
      return;
    }

    console.warn(`[CORS] Blocked origin: ${origin}`);
    callback(createCorsRejectionError(origin));
  };

  app.options(
    '*',
    cors({
      origin: resolveOrigin,
      credentials: true,
      methods: CORS_METHODS,
      allowedHeaders: CORS_HEADERS,
    }),
  );

  app.use(
    cors({
      origin: resolveOrigin,
      credentials: true,
      methods: CORS_METHODS,
      allowedHeaders: CORS_HEADERS,
    }),
  );
};
