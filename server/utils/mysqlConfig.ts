const TCP_DSN_PATTERN = /^(?<user>[^:@/?#]+)(?::(?<password>[^@/?#]*))?@tcp\((?<host>[^)]+)\)\/(?<database>[^?]+)(?:\?(?<query>.*))?$/;
const DEFAULT_PORT = 3306;

export interface MysqlConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  source: string;
}

function decodePart(value: string | null | undefined): string {
  if (value === undefined || value === null) {
    return '';
  }

  try {
    return decodeURIComponent(String(value));
  } catch {
    return String(value);
  }
}

function normalizePort(value: string | number | null | undefined): number {
  const parsed = Number.parseInt(String(value || DEFAULT_PORT), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}

function splitHostAndPort(rawHost: string | null | undefined): { host: string; port: number } {
  if (!rawHost) {
    return { host: '', port: DEFAULT_PORT };
  }

  const value = String(rawHost).trim();
  const bracketMatch = value.match(/^\[(.+)\](?::(\d+))?$/);
  if (bracketMatch) {
    return {
      host: bracketMatch[1],
      port: normalizePort(bracketMatch[2]),
    };
  }

  const lastColonIndex = value.lastIndexOf(':');
  if (lastColonIndex > -1 && value.indexOf(':') === lastColonIndex) {
    return {
      host: value.slice(0, lastColonIndex),
      port: normalizePort(value.slice(lastColonIndex + 1)),
    };
  }

  return { host: value, port: DEFAULT_PORT };
}

export function parseMysqlConnectionString(connectionString: string | null | undefined, label = 'MYSQL_URL'): MysqlConfig {
  const trimmed = String(connectionString || '').trim();
  if (!trimmed) {
    throw new Error(`${label} is empty`);
  }

  if (/^mysql:\/\//i.test(trimmed)) {
    const parsed = new URL(trimmed);
    const database = parsed.pathname.replace(/^\/+/, '');
    if (!parsed.hostname || !parsed.username || !database) {
      throw new Error(`${label} must include host, user, and database`);
    }

    return {
      host: decodePart(parsed.hostname),
      port: normalizePort(parsed.port),
      user: decodePart(parsed.username),
      password: decodePart(parsed.password),
      database: decodePart(database),
      source: label,
    };
  }

  const tcpMatch = trimmed.match(TCP_DSN_PATTERN);
  if (tcpMatch?.groups) {
    const { host: hostPart, port } = splitHostAndPort(tcpMatch.groups.host);
    if (!hostPart || !tcpMatch.groups.user || !tcpMatch.groups.database) {
      throw new Error(`${label} must include host, user, and database`);
    }

    return {
      host: decodePart(hostPart),
      port,
      user: decodePart(tcpMatch.groups.user),
      password: decodePart(tcpMatch.groups.password),
      database: decodePart(tcpMatch.groups.database),
      source: label,
    };
  }

  throw new Error(`${label} uses an unsupported MySQL connection string format`);
}

interface DiscreteEnvNames {
  hostEnvName: string;
  portEnvName: string;
  userEnvName: string;
  passwordEnvName: string;
  databaseEnvNames: string[];
}

function resolveFromDiscreteEnv(env: NodeJS.ProcessEnv, names: DiscreteEnvNames): MysqlConfig | null {
  const host = env[names.hostEnvName]?.trim();
  const user = env[names.userEnvName]?.trim();
  const password = env[names.passwordEnvName] ?? '';
  const database = names.databaseEnvNames
    .map((name) => env[name]?.trim())
    .find(Boolean);

  const hasAnyValue = [host, user, password, database].some(
    (value) => value !== undefined && value !== null && value !== ''
  );
  if (!hasAnyValue) {
    return null;
  }

  if (!host || !user || !database) {
    throw new Error(
      `Incomplete MySQL configuration in ${names.hostEnvName}/${names.userEnvName}/${names.databaseEnvNames.join(', ')}`
    );
  }

  return {
    host,
    port: normalizePort(env[names.portEnvName]),
    user,
    password,
    database,
    source: `${names.hostEnvName}/${names.userEnvName}/${names.databaseEnvNames[0]}`,
  };
}

interface ResolveMysqlConfigOptions {
  urlEnvNames: string[];
  discrete: DiscreteEnvNames;
  required?: boolean;
}

function resolveMysqlConfig(env: NodeJS.ProcessEnv, options: ResolveMysqlConfigOptions): MysqlConfig | null {
  const { urlEnvNames, discrete, required = false } = options;

  for (const envName of urlEnvNames) {
    if (env[envName]?.trim()) {
      return parseMysqlConnectionString(env[envName], envName);
    }
  }

  const discreteConfig = resolveFromDiscreteEnv(env, discrete);
  if (discreteConfig) {
    return discreteConfig;
  }

  if (required) {
    throw new Error(
      `Missing MySQL configuration. Checked ${urlEnvNames.join(', ')} and ${discrete.hostEnvName}/${discrete.userEnvName}/${discrete.databaseEnvNames.join(', ')}`
    );
  }

  return null;
}

export function resolveMasterDbConfig(env: NodeJS.ProcessEnv = process.env): MysqlConfig {
  return resolveMysqlConfig(env, {
    urlEnvNames: ['CURAFLOW_MASTER_MYSQL_URL', 'MYSQL_URL'],
    discrete: {
      hostEnvName: 'MYSQL_HOST',
      portEnvName: 'MYSQL_PORT',
      userEnvName: 'MYSQL_USER',
      passwordEnvName: 'MYSQL_PASSWORD',
      databaseEnvNames: ['MYSQL_DATABASE'],
    },
    required: true,
  }) as MysqlConfig;
}

export function resolveTenantDbConfig(env: NodeJS.ProcessEnv = process.env, masterConfig: MysqlConfig | null = null): MysqlConfig | null {
  const hasDedicatedTenantConnection = [
    'CURAFLOW_TENANT_MYSQL_URL',
    'TEST_TENANT_MYSQL_HOST',
    'TEST_TENANT_MYSQL_USER',
    'TEST_TENANT_MYSQL_PASSWORD',
    'TEST_TENANT_MYSQL_DATABASE',
  ].some((name) => env[name]?.trim());

  const directConfig = hasDedicatedTenantConnection
    ? resolveMysqlConfig(env, {
      urlEnvNames: ['CURAFLOW_TENANT_MYSQL_URL'],
      discrete: {
        hostEnvName: 'TEST_TENANT_MYSQL_HOST',
        portEnvName: 'TEST_TENANT_MYSQL_PORT',
        userEnvName: 'TEST_TENANT_MYSQL_USER',
        passwordEnvName: 'TEST_TENANT_MYSQL_PASSWORD',
        databaseEnvNames: ['TEST_TENANT_MYSQL_DATABASE', 'CURAFLOW_TENANT_DATABASE', 'TEST_TENANT_DATABASE'],
      },
      required: false,
    })
    : null;

  if (directConfig) {
    return directConfig;
  }

  const tenantDatabase = ['CURAFLOW_TENANT_DATABASE', 'TEST_TENANT_DATABASE']
    .map((name) => env[name]?.trim())
    .find(Boolean);

  if (tenantDatabase && masterConfig) {
    return {
      ...masterConfig,
      database: tenantDatabase,
      source: `${masterConfig.source}+${tenantDatabase}`,
    };
  }

  return null;
}
