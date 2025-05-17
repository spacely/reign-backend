const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const pool = require('./config/db');
require('dotenv').config();

// Import routes
const profilesRouter = require('./routes/profiles');
const locationsRouter = require('./routes/locations');

const app = express();
const port = process.env.PORT || 3000;

// Test database connection on startup
pool.query('SELECT NOW()', (err) => {
    if (err) {
        console.error('Fatal: Database connection failed:', err);
        process.exit(1); // Exit if we can't connect to the database
    }
    console.log('Successfully connected to Railway PostgreSQL');
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/profiles', profilesRouter);
app.use('/locations', locationsRouter);

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

// Start server
app.listen(port, '0.0.0.0', () => {
    console.log(`Reign backend service running on port ${port}`);
}); 