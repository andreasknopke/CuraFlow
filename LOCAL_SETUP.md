# CuraFlow - Local Setup Guide

Schedule management application for healthcare facilities.

## Prerequisites

- Node.js 18+ 
- MySQL 5.7+ or MariaDB 10.3+
- npm or yarn

## Quick Start

### 1. Database Setup

```bash
# Create database and tables
mysql -u root -p < schema.sql

# Or connect to MySQL and run:
mysql -u root -p
source schema.sql
```

Default admin account:
- Email: `admin@curaflow.local`
- Password: `admin123` (change immediately after first login!)

### 2. Environment Configuration

Create `.env.local` in project root:
```env
VITE_API_URL=http://localhost:3000
```

Create `server/.env`:
```env
NODE_ENV=development
PORT=3000

# MySQL Database
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=curaflow

# JWT Secret (generate with: openssl rand -hex 32)
JWT_SECRET=your_secret_key_here

# Frontend URL for CORS
FRONTEND_URL=http://localhost:5173

# Optional: OpenAI for AI features
# OPENAI_API_KEY=sk-...

# Optional: SMTP for email notifications
# SMTP_HOST=smtp.gmail.com
# SMTP_PORT=587
# SMTP_SECURE=false
# SMTP_USER=your-email@gmail.com
# SMTP_PASSWORD=your-app-password
```

### 3. Install Dependencies

```bash
# Install frontend dependencies
npm install

# Install backend dependencies
cd server
npm install
cd ..
```

### 4. Start Development Servers

Terminal 1 - Backend:
```bash
cd server
npm run dev
```

Terminal 2 - Frontend:
```bash
npm run dev
```

Access the app at: http://localhost:5173

## Project Structure

```
curaflow/
├── src/                    # Frontend source
│   ├── api/               # API client & entities
│   ├── components/        # React components
│   ├── pages/            # Page components
│   └── lib/              # Utilities & contexts
├── server/                # Backend Express server
│   ├── routes/           # API endpoints
│   └── index.js          # Server entry
├── schema.sql            # Database schema
└── package.json          # Frontend dependencies
```

## Features

- **Schedule Management**: Create and manage shift schedules
- **Staff Management**: Manage doctors/staff and their assignments
- **Vacation Requests**: Handle time-off requests
- **Staffing Plans**: Define required staffing levels
- **Notifications**: Email notifications for schedule changes
- **Multi-tenant**: Support for multiple database configurations
- **Voice Commands**: Optional ElevenLabs integration
- **AI Assistant**: Optional OpenAI integration for schedule suggestions

## API Endpoints

### Authentication
- `POST /api/auth/login` - Login
- `POST /api/auth/register` - Register new user
- `GET /api/auth/me` - Get current user
- `PUT /api/auth/me` - Update current user

### Database
- `POST /api/db` - Generic CRUD operations for all entities

### Schedule
- `GET /api/schedule/:year/:month` - Get schedule
- `POST /api/schedule/:year/:month` - Update schedule
- `GET /api/schedule/:year/:month/export` - Export to Excel

### Integrations
- `POST /api/integrations/llm` - OpenAI LLM calls
- `POST /api/integrations/email` - Send emails
- `POST /api/integrations/upload` - File uploads

## Development

### Frontend
- Built with React + Vite
- UI: Radix UI + Tailwind CSS
- State: React Query
- Routing: React Router

### Backend
- Express.js server
- MySQL with connection pooling
- JWT authentication
- Rate limiting & security headers

## Optional Features

### OpenAI Integration
Set `OPENAI_API_KEY` to enable:
- AI schedule suggestions
- Voice command processing
- Smart auto-fill

### Email Notifications
Configure SMTP settings to enable:
- Shift change notifications
- Schedule distribution
- Vacation request updates

### ElevenLabs Voice
Requires `ELEVENLABS_API_KEY` for:
- Voice commands
- Interactive conversations

## Troubleshooting

### Database Connection Failed
- Check MySQL is running: `mysql -u root -p`
- Verify credentials in `server/.env`
- Ensure database exists: `SHOW DATABASES;`

### Frontend Won't Start
- Clear node_modules: `rm -rf node_modules && npm install`
- Check port 5173 is available
- Verify `.env.local` is configured

### Backend Won't Start
- Check port 3000 is available
- Verify all environment variables in `server/.env`
- Check MySQL connection

### CORS Errors
- Ensure frontend URL matches `VITE_API_URL` in `.env.local`
- Backend `FRONTEND_URL` should match dev server port
- Check browser console for specific error

## Production Deployment

See deployment documentation for:
- Railway deployment
- Docker containerization
- Environment security
- Database migrations

## License

Proprietary - All rights reserved

## Support

For issues and questions, please open an issue on the project repository.
