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

// Function to verify schema
async function verifySchema(client) {
    const result = await client.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'users'
    `);

    const columns = result.rows.map(row => row.column_name);
    const requiredColumns = ['id', 'email', 'created_at', 'updated_at'];

    const missingColumns = requiredColumns.filter(col => !columns.includes(col));
    if (missingColumns.length > 0) {
        throw new Error(`Missing required columns in users table: ${missingColumns.join(', ')}`);
    }
}

// Function to run migrations
async function runMigrations(client) {
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

// Function to bootstrap schema
async function bootstrapSchema() {
    const client = await pool.connect();
    try {
        // Enable PostGIS extensions first
        await enablePostGISExtensions(client);

        // Read the schema file
        const schemaPath = path.join(__dirname, '../../database/schema.sql');
        const schemaSQL = fs.readFileSync(schemaPath, 'utf8');

        // Execute the schema
        await client.query(schemaSQL);
        console.log('Schema successfully bootstrapped');

        // Run migrations
        await runMigrations(client);
        console.log('Migrations completed');

        // Verify schema
        await verifySchema(client);
        console.log('Schema verification successful');
    } catch (err) {
        console.error('Error bootstrapping schema:', err);
        throw err; // Re-throw to handle in index.js
    } finally {
        client.release();
    }
}

module.exports = {
    pool,
    bootstrapSchema,
    enablePostGISExtensions
}; 