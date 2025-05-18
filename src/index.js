const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { pool, bootstrapSchema } = require('./config/db');
require('dotenv').config();

// Import routes
const profilesRouter = require('./routes/profiles');
const locationsRouter = require('./routes/locations');
const pingsRouter = require('./routes/pings');

const app = express();
const port = process.env.PORT || 3000;

// Initialize database and bootstrap schema
async function initializeDatabase() {
    try {
        // Test database connection
        await pool.query('SELECT NOW()');
        console.log('Successfully connected to Railway PostgreSQL');

        console.log('Starting database initialization...');
        console.log('This will drop all existing tables and recreate the schema...');

        // Bootstrap schema (this will drop everything first)
        await bootstrapSchema();
        console.log('Database initialization complete with fresh schema');
    } catch (err) {
        console.error('Fatal: Database initialization failed:', err);
        process.exit(1);
    }
}

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/profiles', profilesRouter);
app.use('/locations', locationsRouter);
app.use('/pings', pingsRouter);

// Health check endpoint (useful for Railway)
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        service: 'reign-backend'
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        error: 'Something went wrong!',
        message: err.message // Always show error in Railway for debugging
    });
});

// Initialize database and start server
initializeDatabase().then(() => {
    app.listen(port, '0.0.0.0', () => {
        console.log(`Reign backend service running on port ${port}`);
    });
}).catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
}); 