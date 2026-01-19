import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';

const USE_RAILWAY = import.meta.env.VITE_USE_RAILWAY === 'true';

// Only initialize Base44 client if not using Railway
let base44 = null;

if (!USE_RAILWAY) {
  const { appId, serverUrl, token, functionsVersion } = appParams;
  
  //Create a client with authentication required
  base44 = createClient({
    appId,
    serverUrl,
    token,
    functionsVersion,
    requiresAuth: false
  });
}

export { base44 };
