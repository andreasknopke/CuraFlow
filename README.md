# CuraFlow Setup Guide

Complete guide to set up CuraFlow on a new development machine.

## Prerequisites

Install the following software:

- **Node.js** (v18 or higher) - [Download](https://nodejs.org/)
- **Docker Desktop** - [Download](https://www.docker.com/products/docker-desktop/)
- **Git** (optional, for version control)

## Project Structure

```
CuraFlow/
├── server/              # Backend (Express + MySQL)
│   ├── .env            # Environment configuration
│   ├── docker-compose.yaml
│   ├── package.json
│   └── routes/
├── src/                # Frontend (React + Vite)
│   ├── components/
│   ├── pages/
│   └── main.jsx
├── schema.sql          # Database schema
└── package.json        # Frontend dependencies
```

## Step 1: Clone or Download Project

```bash
# If using Git
git clone <repository-url>
cd CuraFlow

# Or download and extract the project files
```

## Step 2: Install Dependencies

### Backend Dependencies
```bash
cd server
npm install
cd ..
```

### Frontend Dependencies
```bash
npm install
```

## Step 3: Configure Environment Variables

### Backend Environment

Copy the example environment file and configure it:

```bash
cd server
cp .env.example .env
```

The `.env` file should look like this:

```env
# Server Configuration
NODE_ENV=development
PORT=3000

# MySQL Database Configuration (Docker Compose)
MYSQL_HOST=localhost
MYSQL_PORT=3307
MYSQL_USER=curaflow
MYSQL_PASSWORD=curaflow123
MYSQL_DATABASE=curaflow

# JWT Configuration
JWT_SECRET=your_generated_secret_here

# Frontend Configuration
FRONTEND_URL=http://localhost:5173
```

**Important:** Generate a new JWT secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output and paste it as the `JWT_SECRET` value in your `.env` file.

### Frontend Environment

Return to the project root and copy the frontend environment file:

```bash
cd ..
cp .env.example .env
```

The `.env` file should contain:

```env
VITE_API_URL=http://localhost:3000
```

**Note:** Both `.env` files are git-ignored and will not be committed to version control.

## Step 4: Start Docker Database

Navigate to the server directory and start the Docker containers:

```bash
cd server
docker compose up -d
```

This will start:
- **MariaDB** database on port `3307`
- **Adminer** (database admin tool) on port `8080`

Wait about 10-15 seconds for the database to fully initialize.

### Verify Docker Containers

```bash
docker compose ps
```

You should see both `curaflow-db` and `curaflow-adminer` running.

## Step 5: Initialize Database

Run the initialization script to create all tables:

```bash
node init-db.js
```

Expected output:
```
🔄 Initializing database...
📊 Found X SQL statements
✅ User
✅ Doctor
✅ ShiftEntry
...
✅ Database initialized successfully!
```

## Step 6: Create Admin User

Create the default admin account:

```bash
node create-admin.js
```

This creates:
- **Email:** `admin@curaflow.local`
- **Password:** `admin123`

The admin will be required to change the password on first login.

## Step 7: Start Backend Server

Still in the `server/` directory:

```bash
npm start
```

Expected output:
```
🚀 CuraFlow Server running on port 3000
📊 Environment: development
🗄️  Database: localhost
```

Keep this terminal running.

## Step 8: Start Frontend

Open a **new terminal** window, navigate to the project root, and start the frontend:

```bash
npm run dev
```

Expected output:
```
  VITE v5.x.x  ready in XXX ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

## Step 9: First Login

1. Open your browser and go to: **http://localhost:5173**
2. You'll be redirected to the login page
3. Enter credentials:
   - Email: `admin@curaflow.local`
   - Password: `admin123`
4. You'll be prompted to change the password
5. Enter the current password (`admin123`) and choose a new secure password

## Step 10: Access Database Admin (Optional)

To manage the database directly, visit: **http://localhost:8080**

Login credentials:
- System: **MySQL**
- Server: **db**
- Username: **curaflow**
- Password: **curaflow123**
- Database: **curaflow**

## Common Commands

### Backend
```bash
cd server

# Start server
npm start

# Start with auto-reload
npm run dev

# Create admin user
node create-admin.js

# Initialize database
node init-db.js
```

### Frontend
```bash
# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### Docker
```bash
cd server

# Start containers
docker compose up -d

# Stop containers
docker compose down

# Stop and remove all data
docker compose down -v

# View logs
docker compose logs -f

# Restart containers
docker compose restart
```

## Troubleshooting

### Database Connection Issues

**Problem:** `ECONNREFUSED` or connection timeout

**Solutions:**
1. Verify Docker containers are running:
   ```bash
   cd server
   docker compose ps
   ```

2. Check database health:
   ```bash
   docker compose logs db
   ```

3. Restart containers:
   ```bash
   docker compose restart
   ```

### JWT Secret Error

**Problem:** `secretOrPrivateKey must have a value`

**Solution:** Restart the backend server completely (Ctrl+C, then `npm start`)

### Port Already in Use

**Problem:** Port 3000 or 5173 already in use

**Solutions:**
- **Backend (3000):** Change `PORT` in `server/.env`
- **Frontend (5173):** Vite will auto-increment to 5174
- Or kill the process using the port:
  ```bash
  # Windows PowerShell
  Get-Process -Id (Get-NetTCPConnection -LocalPort 3000).OwningProcess | Stop-Process
  
  # Linux/Mac
  kill $(lsof -ti:3000)
  ```

### Table Doesn't Exist

**Problem:** `Table 'curaflow.User' doesn't exist`

**Solution:** Re-run database initialization:
```bash
cd server
node init-db.js
```

### Docker Not Found

**Problem:** `docker: command not found`

**Solution:** Install Docker Desktop and ensure it's running

### Login Failed

**Problem:** "Ungültige Anmeldedaten" (Invalid credentials)

**Solutions:**
1. Ensure admin user was created:
   ```bash
   cd server
   node create-admin.js
   ```

2. Use correct credentials:
   - Email: `admin@curaflow.local`
   - Password: `admin123`

3. Check backend logs for detailed error messages

## Data Persistence

- Database data is stored in a Docker volume: `curaflow-db-data`
- Data persists even after `docker compose down`
- To completely reset the database:
  ```bash
  cd server
  docker compose down -v
  docker compose up -d
  node init-db.js
  node create-admin.js
  ```

## Production Deployment

For production deployment:

1. Generate new JWT secret
2. Update `MYSQL_PASSWORD` in `server/.env` and `docker-compose.yaml`
3. Build frontend: `npm run build`
4. Deploy built files from `dist/` folder
5. Use environment variables instead of `.env` file
6. Enable HTTPS/SSL
7. Configure proper CORS origins

## Tech Stack

- **Frontend:** React 18, Vite, TailwindCSS, shadcn/ui
- **Backend:** Node.js, Express, JWT authentication
- **Database:** MariaDB (via Docker)
- **State Management:** TanStack Query (React Query)

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review server logs in the terminal
3. Check browser console for frontend errors
4. Verify database connection via Adminer (port 8080)

## Next Steps

After successful setup:

1. Create additional users via Admin panel
2. Add staff/doctors in the Staff section
3. Configure workplaces and shift types
4. Start scheduling shifts
5. Explore the various modules (Schedule, Vacation, Statistics, etc.)

---

**Happy scheduling with CuraFlow! 🚀**
