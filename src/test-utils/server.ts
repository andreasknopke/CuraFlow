import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

function clone(value: any) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function ensureArray(value: any) {
  return Array.isArray(value) ? value : [];
}

function normalizeEntities(entities: any = {}) {
  return Object.fromEntries(
    Object.entries(entities).map(([entityName, records]) => [entityName, ensureArray(records).map(clone)])
  );
}

function createEntityStore(initialEntities: any = {}) {
  const entities = normalizeEntities(initialEntities);

  const ensureEntity = (entityName: any) => {
    if (!entities[entityName]) {
      entities[entityName] = [];
    }

    return entities[entityName];
  };

  const getId = (record: any) => record?.id ?? record?._id;

  return {
    all(entityName: any) {
      return clone(ensureEntity(entityName));
    },
    get(entityName: any, id: any) {
      return clone(ensureEntity(entityName).find((record: any) => getId(record) === id) ?? null);
    },
    list(entityName: any) {
      return clone(ensureEntity(entityName));
    },
    filter(entityName: any, query: any = {}) {
      const records = ensureEntity(entityName);
      const filtered = records.filter((record: any) =>
        Object.entries(query).every(([key, expected]) => {
          const actual = record?.[key];

          if (Array.isArray(expected)) {
            return expected.includes(actual);
          }

              if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
                if (Array.isArray((expected as any).$in)) {
                  return (expected as any).$in.includes(actual);
                }

                if ((expected as any).$ne !== undefined) {
                  return actual !== (expected as any).$ne;
                }

                if ((expected as any).$gte !== undefined) {
                  if (String(actual) < String((expected as any).$gte)) return false;
                }

                if ((expected as any).$lte !== undefined) {
                  if (String(actual) > String((expected as any).$lte)) return false;
                }

                if ((expected as any).$gt !== undefined) {
                  if (String(actual) <= String((expected as any).$gt)) return false;
                }

                if ((expected as any).$lt !== undefined) {
                  if (String(actual) >= String((expected as any).$lt)) return false;
                }

                // Operator-based query matched all checks (none returned false)
                const hasOperator = ['$in', '$ne', '$gte', '$lte', '$gt', '$lt']
                  .some(op => (expected as any)[op] !== undefined);
                if (hasOperator) return true;
              }

          return actual === expected;
        })
      );

      return clone(filtered);
    },
    create(entityName: any, data: any = {}) {
      const records = ensureEntity(entityName);
      const nextRecord = {
        id: data.id ?? `${String(entityName).toLowerCase()}-${records.length + 1}`,
        ...clone(data),
      };

      records.push(nextRecord);
      return clone(nextRecord);
    },
    update(entityName: any, id: any, data: any = {}) {
      const records = ensureEntity(entityName);
      const index = records.findIndex((record: any) => getId(record) === id);

      if (index === -1) {
        return null;
      }

      records[index] = {
        ...records[index],
        ...clone(data),
      };

      return clone(records[index]);
    },
    delete(entityName: any, id: any) {
      const records = ensureEntity(entityName);
      const index = records.findIndex((record: any) => getId(record) === id);

      if (index === -1) {
        return false;
      }

      records.splice(index, 1);
      return true;
    },
    bulkCreate(entityName: any, data: any = []) {
      return ensureArray(data).map((record: any) => this.create(entityName, record));
    },
  };
}

function errorResponse(status: any, error: any) {
  return HttpResponse.json({ error }, { status });
}

export const server = setupServer();

export function createDbHandlers({ entities = {}, onRequest }: any = {}) {
  const store = createEntityStore(entities);

  return [
    http.post('*/api/db', async ({ request }) => {
      const payload: any = await request.json();
      const { action, table, id, data, query } = payload;

      onRequest?.(payload, store);

      switch (action) {
        case 'list':
          return HttpResponse.json(store.list(table));
        case 'filter':
          return HttpResponse.json(store.filter(table, query));
        case 'get': {
          const record = store.get(table, id);
          return record ? HttpResponse.json(record) : errorResponse(404, `${table} ${id} not found`);
        }
        case 'create':
          return HttpResponse.json(store.create(table, data));
        case 'update': {
          const record = store.update(table, id, data);
          return record ? HttpResponse.json(record) : errorResponse(404, `${table} ${id} not found`);
        }
        case 'delete': {
          const deleted = store.delete(table, id);
          return deleted
            ? HttpResponse.json({ success: true, id })
            : errorResponse(404, `${table} ${id} not found`);
        }
        case 'bulkCreate':
          return HttpResponse.json(store.bulkCreate(table, data));
        default:
          return errorResponse(400, `Unsupported db action: ${action}`);
      }
    }),
  ];
}

export function createAuthHandlers({
  user = null,
  loginResponse = null,
  tenants = [],
  hasFullAccess = false,
}: any = {}) {
  const clonedUser = user ? clone(user) : null;

  return [
    http.get('*/api/auth/me', () => {
      if (!clonedUser) {
        return errorResponse(401, 'Unauthorized');
      }

      return HttpResponse.json(clone(clonedUser));
    }),
    http.post('*/api/auth/login', async ({ request }) => {
      const credentials = await request.json();

      if (typeof loginResponse === 'function') {
        return HttpResponse.json(await loginResponse(credentials));
      }

      if (loginResponse) {
        return HttpResponse.json(clone(loginResponse));
      }

      if (!clonedUser) {
        return errorResponse(401, 'Invalid credentials');
      }

      return HttpResponse.json({
        token: 'test-jwt-token',
        user: clone(clonedUser),
        must_change_password: clonedUser.must_change_password === true,
      });
    }),
    http.get('*/api/auth/my-tenants', () =>
      HttpResponse.json({
        tenants: clone(tenants),
        hasFullAccess,
      })
    ),
    http.post('*/api/auth/presence', () => HttpResponse.json({ success: true })),
    http.post('*/api/auth/activate-tenant/:tokenId', ({ params }) =>
      HttpResponse.json({
        success: true,
        tokenId: params.tokenId,
      })
    ),
  ];
}

export function createRouteHandler(method: any, path: any, resolver: any) {
  return (http as any)[String(method).toLowerCase()](path, resolver);
}
