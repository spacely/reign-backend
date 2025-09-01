# Reign Backend Development Guide

## Overview

This guide covers the development, deployment, and operational aspects of the Reign Backend service. It's designed for developers who need to set up, modify, or maintain the backend service.

## Project Structure

```
reign-backend/
├── src/
│   ├── config/
│   │   └── db.js              # Database configuration and connection
│   ├── routes/
│   │   ├── profiles.js        # User profile management
│   │   ├── locations.js       # Location services
│   │   ├── pings.js          # Location-based broadcasting
│   │   ├── connect.js        # Social connections
│   │   └── validation.js     # Peer validation system
│   ├── utils/
│   │   └── geo.js            # Geographic utility functions
│   └── index.js              # Main application entry point
├── database/
│   ├── schema.sql            # Database schema definition
│   └── migrations/           # Database migration files
├── scripts/
│   └── dev/                  # Development utilities
├── Dockerfile                # Container configuration
├── package.json             # Dependencies and scripts
└── README.md                # Basic project information
```

## Prerequisites

- **Node.js**: Version 18 or higher
- **PostgreSQL**: Version 13 or higher with PostGIS extension
- **npm**: Version 8 or higher
- **Docker**: (Optional) For containerized deployment

## Installation & Setup

### 1. Clone and Install Dependencies

```bash
git clone <repository-url>
cd reign-backend
npm install
```

### 2. Database Setup

#### PostgreSQL Installation
```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install postgresql postgresql-contrib postgis

# macOS with Homebrew
brew install postgresql postgis

# Start PostgreSQL service
sudo systemctl start postgresql  # Linux
brew services start postgresql   # macOS
```

#### Create Database
```bash
sudo -u postgres psql
CREATE DATABASE reign_db;
CREATE USER reign_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE reign_db TO reign_user;
\q
```

#### Enable PostGIS Extensions
```bash
psql -U reign_user -d reign_db
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS earthdistance;
\q
```

### 3. Environment Configuration

Create a `.env` file in the project root:

```env
# Database Configuration
DATABASE_URL=postgresql://reign_user:your_password@localhost:5432/reign_db

# Server Configuration
PORT=3000
NODE_ENV=development

# Optional: Allow migrations in production
ALLOW_MIGRATIONS=false
```

### 4. Database Schema Setup

Run the schema creation script:
```bash
psql -U reign_user -d reign_db -f database/schema.sql
```

### 5. Run Database Migrations

If you have migration files, run them:
```bash
# This is handled automatically by the application
# But you can run them manually if needed
psql -U reign_user -d reign_db -f database/migrations/001_add_name_to_users.sql
```

## Development

### Running the Development Server

```bash
# Development with hot reload
npm run dev

# Production mode
npm start

# Run tests
npm test
```

The server will start on `http://localhost:3000` (or the port specified in your `.env` file).

### Database Management

#### Database Connection
The application uses PostgreSQL with connection pooling. Configuration is in `src/config/db.js`.

#### Migration System
The application includes a migration system that:
- Tracks applied migrations in `schema_migrations` table
- Applies migrations automatically on startup (development only)
- Supports rollback protection

#### Adding New Migrations
1. Create a new `.sql` file in `database/migrations/`
2. Use naming convention: `XXX_description.sql`
3. Migrations are applied in alphabetical order

#### Example Migration:
```sql
-- 007_add_user_preferences.sql
CREATE TABLE IF NOT EXISTS user_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    preferences JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### API Development

#### Adding New Endpoints
1. Create or modify route files in `src/routes/`
2. Follow existing patterns for validation, error handling
3. Update API documentation

#### Common Patterns

**Input Validation:**
```javascript
// Validate required fields
if (!field1 || !field2) {
    return res.status(400).json({
        error: 'Missing required fields',
        details: {
            field1: !field1 ? 'Missing field1' : null,
            field2: !field2 ? 'Missing field2' : null
        }
    });
}

// Validate UUID format
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!UUID_REGEX.test(userId)) {
    return res.status(400).json({
        error: 'Invalid userId',
        details: 'userId must be a valid UUID'
    });
}
```

**Database Transactions:**
```javascript
const client = await pool.connect();
try {
    await client.query('BEGIN');
    
    // Your database operations here
    const result = await client.query('INSERT INTO ...');
    
    await client.query('COMMIT');
    res.json({ success: true });
} catch (err) {
    await client.query('ROLLBACK');
    throw err;
} finally {
    client.release();
}
```

**Error Handling:**
```javascript
catch (err) {
    console.error('Error description:', err);
    res.status(500).json({
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
}
```

### Testing

#### Running Tests
```bash
npm test
```

#### Test Structure
- Unit tests for utility functions
- Integration tests for API endpoints
- Database tests with transaction rollback

#### Example Test:
```javascript
describe('POST /profiles', () => {
    it('should create a new profile', async () => {
        const response = await request(app)
            .post('/profiles')
            .send({
                email: 'test@example.com',
                name: 'Test User'
            });
        
        expect(response.status).toBe(201);
        expect(response.body.status).toBe('ok');
    });
});
```

## Deployment

### Docker Deployment

#### Build Image
```bash
docker build -t reign-backend .
```

#### Run Container
```bash
docker run -p 3000:3000 \
  -e DATABASE_URL=postgresql://user:pass@host:5432/db \
  -e NODE_ENV=production \
  reign-backend
```

#### Docker Compose
```yaml
version: '3.8'
services:
  backend:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://postgres:password@db:5432/reign_db
      - NODE_ENV=production
    depends_on:
      - db
    
  db:
    image: postgis/postgis:13-3.1
    environment:
      - POSTGRES_DB=reign_db
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=password
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./database/schema.sql:/docker-entrypoint-initdb.d/schema.sql

volumes:
  postgres_data:
```

### Railway Deployment

The application is configured for Railway deployment:

1. **Automatic Deployment**: Push to main branch triggers deployment
2. **Environment Variables**: Set `DATABASE_URL` in Railway dashboard
3. **PostgreSQL**: Use Railway's PostgreSQL service
4. **Health Checks**: `/health` endpoint for monitoring

### Production Considerations

#### Environment Variables
```env
DATABASE_URL=postgresql://user:pass@host:5432/db
NODE_ENV=production
PORT=3000
ALLOW_MIGRATIONS=false
```

#### Database Optimization
- Connection pooling configured in `src/config/db.js`
- Indexes on frequently queried columns
- PostGIS extensions for geospatial queries

#### Security
- Helmet middleware for security headers
- CORS configured for cross-origin requests
- Input validation and sanitization
- SQL injection protection via parameterized queries

#### Monitoring
- Health check endpoint: `GET /health`
- Error logging with stack traces in development
- Database connection verification on startup

## Operational Tasks

### Database Maintenance

#### Backup Database
```bash
pg_dump -U reign_user reign_db > backup.sql
```

#### Restore Database
```bash
psql -U reign_user -d reign_db < backup.sql
```

#### Check Database Performance
```sql
-- Check table sizes
SELECT schemaname, tablename, 
       pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Check index usage
SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetch
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC;
```

### Performance Monitoring

#### Key Metrics to Monitor
- Response time for API endpoints
- Database connection pool usage
- Memory usage and garbage collection
- Geographic query performance

#### Useful Queries
```sql
-- Check recent activity
SELECT COUNT(*) as total_users FROM users;
SELECT COUNT(*) as active_pings FROM pings WHERE created_at > NOW() - INTERVAL '15 minutes';
SELECT COUNT(*) as recent_locations FROM locations WHERE created_at > NOW() - INTERVAL '1 hour';

-- Check geographic distribution
SELECT 
    COUNT(*) as user_count,
    ROUND(AVG(latitude)::numeric, 2) as avg_lat,
    ROUND(AVG(longitude)::numeric, 2) as avg_lng
FROM locations;
```

### Troubleshooting

#### Common Issues

1. **Database Connection Errors**
   - Check `DATABASE_URL` environment variable
   - Verify PostgreSQL service is running
   - Check network connectivity

2. **PostGIS Extension Issues**
   - Ensure PostGIS is installed: `CREATE EXTENSION IF NOT EXISTS postgis;`
   - Check extension status: `SELECT * FROM pg_extension;`

3. **Migration Failures**
   - Check migration logs in console
   - Verify migration file syntax
   - Check `schema_migrations` table

4. **Geographic Query Performance**
   - Ensure indexes on latitude/longitude columns
   - Check PostGIS extension installation
   - Monitor query execution plans

#### Debugging
```bash
# Check logs
docker logs reign-backend

# Database connection test
psql -U reign_user -d reign_db -c "SELECT NOW();"

# Check server health
curl http://localhost:3000/health
```

## Contributing

### Code Style
- Use consistent indentation (2 spaces)
- Follow existing error handling patterns
- Add input validation for all endpoints
- Update documentation for new features

### Pull Request Process
1. Create feature branch from main
2. Implement changes with tests
3. Update documentation
4. Submit pull request with detailed description

### Database Changes
- Always create migrations for schema changes
- Test migrations on development database
- Never modify existing migration files
- Document breaking changes

## Security Considerations

### Data Protection
- All user data encrypted in transit (HTTPS)
- No sensitive data in logs
- Input validation prevents injection attacks
- UUID primary keys prevent enumeration

### Location Privacy
- Location data only stored for active sessions
- Proximity calculations use PostGIS for accuracy
- No location history beyond recent updates

### API Security
- Rate limiting recommended for production
- Authentication/authorization as needed
- CORS configured for allowed origins
- Security headers via Helmet middleware