export const CORS_HEADERS = ['Content-Type', 'Authorization', 'X-Requested-With', 'X-DB-Token'];
export const CORS_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

export const buildAllowedOrigins = (serverConfig = {}) => {
  const configuredAllowedOrigins = serverConfig.allowedOrigins
    ? serverConfig.allowedOrigins
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
    : [];

  return Array.from(
    new Set(
      [
        'https://curaflow-production.up.railway.app',
        'https://curaflow-frontend-production.up.railway.app',
        serverConfig.frontendUrl,
        ...configuredAllowedOrigins,
        'http://localhost:5173',
        'http://localhost:3000',
      ].filter(Boolean),
    ),
  );
};

export const isOriginAllowed = (origin, allowedOrigins) => {
  if (!origin) {
    return true;
  }

  if (origin.endsWith('.railway.app')) {
    return true;
  }

  return allowedOrigins.includes(origin);
};

export const createCorsRejectionError = (origin) => {
  const error = new Error('Not allowed by CORS');
  error.status = 403;
  error.origin = origin;
  return error;
};
