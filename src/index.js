const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { pool, verifyDatabaseConnection } = require('./config/db');
require('dotenv').config();

// Import routes
const profilesRouter = require('./routes/profiles');
const locationsRouter = require('./routes/locations');
const pingsRouter = require('./routes/pings');
const connectRouter = require('./routes/connect');

const app = express();
const port = process.env.PORT || 3000;

// Initialize database connection
async function initializeDatabase() {
    try {
        // Only verify connection and extensions
        await verifyDatabaseConnection();
        console.log('Database connection and schema verified successfully');
    } catch (err) {
        console.error('Fatal: Database connection failed:', err);
        process.exit(1);
    }
}

// Middleware
app.use(cors());
app.use(helmet());
app.use(express.json());

// Routes
app.use('/profiles', profilesRouter);
app.use('/locations', locationsRouter);
app.use('/pings', pingsRouter);
app.use('/connect', connectRouter);

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Welcome route
app.get('/', (req, res) => {
    res.json({
        message: 'Welcome to Reign backend service',
        version: '1.0.0'
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