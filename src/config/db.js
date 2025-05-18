const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Railway automatically injects DATABASE_URL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // Required for Railway's PostgreSQL
    }
});

// Function to enable PostGIS extensions
async function enablePostGISExtensions(client) {
    await client.query(`
        CREATE EXTENSION IF NOT EXISTS cube;
        CREATE EXTENSION IF NOT EXISTS earthdistance;
    `);
    console.log('PostGIS extensions enabled');
}

// Function to verify database connection and schema
async function verifyDatabaseConnection() {
    const client = await pool.connect();
    try {
        // Test basic connection
        await client.query('SELECT NOW()');
        console.log('Successfully connected to PostgreSQL');

        // Enable required extensions
        await enablePostGISExtensions(client);

        // Verify schema exists
        await verifySchema(client);
    } finally {
        client.release();
    }
}

// Function to verify schema
async function verifySchema(client) {
    // Check if tables exist
    const tables = ['users', 'profile_items', 'locations', 'pings'];
    for (const table of tables) {
        const result = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = $1
            );
        `, [table]);

        if (!result.rows[0].exists) {
            throw new Error(`Required table '${table}' does not exist. Please run migrations manually.`);
        }
    }

    // Verify users table structure
    const result = await client.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'users'
    `);

    const columns = result.rows.map(row => row.column_name);
    const requiredColumns = ['id', 'email', 'name', 'created_at', 'updated_at'];

    const missingColumns = requiredColumns.filter(col => !columns.includes(col));
    if (missingColumns.length > 0) {
        throw new Error(`Missing required columns in users table: ${missingColumns.join(', ')}`);
    }
}

// Function to run migrations
async function runMigrations(client) {
    // Prevent running in production unless explicitly allowed
    if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_MIGRATIONS) {
        throw new Error('Cannot run migrations in production without ALLOW_MIGRATIONS flag');
    }

    const migrationsDir = path.join(__dirname, '../../database/migrations');

    try {
        // Create migrations table if it doesn't exist
        await client.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL UNIQUE,
                applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Get list of migration files
        const migrationFiles = fs.readdirSync(migrationsDir)
            .filter(file => file.endsWith('.sql'))
            .sort();

        // Get applied migrations
        const { rows: appliedMigrations } = await client.query(
            'SELECT name FROM schema_migrations'
        );
        const appliedMigrationNames = appliedMigrations.map(m => m.name);

        // Apply new migrations
        for (const file of migrationFiles) {
            if (!appliedMigrationNames.includes(file)) {
                const migrationPath = path.join(migrationsDir, file);
                const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

                await client.query('BEGIN');
                try {
                    await client.query(migrationSQL);
                    await client.query(
                        'INSERT INTO schema_migrations (name) VALUES ($1)',
                        [file]
                    );
                    await client.query('COMMIT');
                    console.log(`Applied migration: ${file}`);
                } catch (err) {
                    await client.query('ROLLBACK');
                    throw err;
                }
            }
        }
    } catch (err) {
        console.error('Error running migrations:', err);
        throw err;
    }
}

// Function to reset database (development only)
async function resetDatabase() {
    if (process.env.NODE_ENV === 'production') {
        throw new Error('Cannot reset database in production environment');
    }

    const client = await pool.connect();
    try {
        const resetScript = fs.readFileSync(path.join(__dirname, '../../scripts/dev/reset/drop_all.sql'), 'utf8');
        await client.query(resetScript);
        console.log('Database reset successfully');
    } finally {
        client.release();
    }
}

module.exports = {
    pool,
    verifyDatabaseConnection,
    runMigrations,
    resetDatabase,
    enablePostGISExtensions
}; 