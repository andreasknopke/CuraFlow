# Migration Completion Checklist

## Manual Steps Required

### 1. Delete Legacy Functions Folder
The `functions/` folder contains old Deno/Base44 serverless functions that are now replaced by Express routes in `server/routes/`.

```powershell
# PowerShell
Remove-Item -Recurse -Force "c:\dev\CuraFlow\functions"
```

### 2. Update Dependencies
Remove old Base44 packages (already removed from package.json):

```bash
# Delete node_modules and reinstall
rm -rf node_modules package-lock.json
npm install

# Do the same for server
cd server
rm -rf node_modules package-lock.json
npm install
cd ..
```

### 3. Setup MySQL Database
```bash
# Login to MySQL
mysql -u root -p

# Run the schema
source schema.sql

# Or in one command:
mysql -u root -p < schema.sql
```

### 4. Configure Environment Variables
Already created but update with your actual values:

**Frontend `.env.local`:**
```env
VITE_API_URL=http://localhost:3000
```

**Backend `server/.env`:**
```env
NODE_ENV=development
PORT=3000

MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=YOUR_ACTUAL_PASSWORD
MYSQL_DATABASE=curaflow

JWT_SECRET=GENERATE_WITH_openssl_rand_-hex_32

FRONTEND_URL=http://localhost:5173
```

### 5. Generate JWT Secret
```bash
# On Windows with Git Bash or WSL:
openssl rand -hex 32

# Or use Node.js:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 6. Optional: Clean Up Documentation
If you don't need Railway deployment docs:

```powershell
Remove-Item "RAILWAY_*.md"
```

Keep `LOCAL_SETUP.md` for local development reference.

### 7. Test the Application

**Terminal 1 - Backend:**
```bash
cd server
npm run dev
```

**Terminal 2 - Frontend:**
```bash
npm run dev
```

**Terminal 3 - Test Login:**
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@curaflow.local","password":"admin123"}'
```

### 8. First Login
1. Open http://localhost:5173
2. Login with:
   - Email: `admin@curaflow.local`
   - Password: `admin123`
3. **Immediately change password** in settings

## What Was Changed

### ✅ Completed Automatically

1. **Removed Base44 SDK dependencies** from package.json
2. **Fixed broken imports** in `src/api/entities.js` and `src/api/integrations.js`
3. **Added integrations support** to `src/api/client.js` for:
   - LLM (OpenAI)
   - Email sending
   - File uploads
4. **Created new integration routes** in `server/routes/integrations.js`
5. **Cleaned up CORS** in `server/index.js` (localhost only, no Railway)
6. **Updated AuthContext** to use local JWT auth
7. **Removed Base44 env variables** from `.env.local`
8. **Created database schema** (`schema.sql`)
9. **Updated package.json name** from "base44-app" to "curaflow"

### 📝 Compatibility Layer

The `base44` object in `src/api/client.js` is kept as a **compatibility shim** so existing code doesn't break:

```javascript
// Old code still works:
base44.functions.invoke('getHolidays', {...})
base44.entities.Doctor.list()
base44.integrations.Core.InvokeLLM({...})
base44.auth.me()

// These now map to:
api.getHolidays(...)
db.Doctor.list()
api.request('/api/integrations/llm', {...})
api.me()
```

This allows gradual migration without breaking existing components.

### 🔄 Future Refactoring (Optional)

To fully remove Base44 references, you can gradually replace:

```javascript
// Change this:
import { base44 } from '@/api/client';
const doctors = await base44.entities.Doctor.list();

// To this:
import { db } from '@/api/client';
const doctors = await db.Doctor.list();

// Or even better:
import { api } from '@/api/client';
const doctors = await api.list('Doctor');
```

But this is **not required** - the compatibility layer works fine.

## Verification Checklist

- [ ] `functions/` folder deleted
- [ ] Dependencies reinstalled (frontend and server)
- [ ] MySQL database created with schema.sql
- [ ] `.env.local` configured with correct API URL
- [ ] `server/.env` configured with database credentials
- [ ] JWT_SECRET generated and added to server/.env
- [ ] Backend starts without errors (npm run dev in server/)
- [ ] Frontend starts without errors (npm run dev in root)
- [ ] Can login at http://localhost:5173
- [ ] Password changed from default

## Known Limitations

### Optional Features Requiring Configuration

1. **OpenAI/LLM Features**: Require `OPENAI_API_KEY`
   - AI schedule suggestions
   - Voice command processing
   
2. **Email Notifications**: Require SMTP configuration
   - Schedule change emails
   - Shift notifications

3. **ElevenLabs Voice**: Requires `ELEVENLABS_API_KEY`
   - Voice commands
   - Audio transcription

These features will gracefully degrade with warnings if not configured.

## Support

If you encounter issues:

1. Check `server/` logs for backend errors
2. Check browser console for frontend errors
3. Verify all environment variables are set
4. Ensure MySQL is running and accessible
5. Check port 3000 and 5173 are available

See `LOCAL_SETUP.md` for detailed troubleshooting.
