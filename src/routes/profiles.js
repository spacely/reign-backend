const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');

// POST /profiles - Create a new user
router.post('/', async (req, res) => {
    const { email, name, items } = req.body;

    // Validate required fields
    if (!email) {
        return res.status(400).json({
            error: 'Missing required fields',
            details: 'Email is required'
        });
    }

    // Validate email format
    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!EMAIL_REGEX.test(email)) {
        return res.status(400).json({
            error: 'Invalid email',
            details: 'Please provide a valid email address'
        });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Create user
        const userResult = await client.query(
            `INSERT INTO users (email, name) 
             VALUES ($1, $2) 
             RETURNING id, email, name, created_at as "createdAt", updated_at as "updatedAt"`,
            [email, name || null]
        );

        const userId = userResult.rows[0].id;
        const profileItems = [];

        // Add profile items if provided
        if (items && Array.isArray(items)) {
            for (const item of items) {
                if (!item.type || !item.data) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        error: 'Invalid profile item',
                        details: 'Each profile item must have type and data fields'
                    });
                }

                const itemResult = await client.query(
                    `INSERT INTO profile_items (user_id, item_type, item_data)
                     VALUES ($1, $2, $3)
                     RETURNING id, item_type, item_data, created_at as "createdAt"`,
                    [userId, item.type, item.data]
                );
                profileItems.push(itemResult.rows[0]);
            }
        }

        await client.query('COMMIT');

        res.status(201).json({
            status: 'ok',
            message: 'Profile created successfully',
            data: {
                user: userResult.rows[0],
                items: profileItems
            }
        });
    } catch (err) {
        await client.query('ROLLBACK');

        if (err.code === '23505') { // Unique violation
            return res.status(409).json({
                error: 'Email already exists',
                details: 'This email address is already registered'
            });
        }

        console.error('Error creating profile:', err);
        res.status(500).json({
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    } finally {
        client.release();
    }
});

// GET /profiles/:id
router.get('/:id', async (req, res) => {
    const { id } = req.params;

    try {
        // Get user profile
        const userQuery = `
            SELECT 
                u.id as "userId",
                u.email,
                u.name,
                u.created_at as "createdAt",
                u.updated_at as "updatedAt"
            FROM users u
            WHERE u.id = $1
        `;

        const userResult = await pool.query(userQuery, [id]);

        if (userResult.rows.length === 0) {
            return res.status(404).json({
                error: 'User not found',
                details: `No user exists with id ${id}`
            });
        }

        // Get profile items
        const itemsQuery = `
            SELECT 
                id,
                item_type as "itemType",
                item_data as "itemData",
                created_at as "createdAt",
                updated_at as "updatedAt"
            FROM profile_items 
            WHERE user_id = $1 
            ORDER BY created_at DESC
        `;

        const itemsResult = await pool.query(itemsQuery, [id]);

        // Get latest location
        const locationQuery = `
            SELECT 
                latitude,
                longitude,
                created_at as "updatedAt"
            FROM locations 
            WHERE user_id = $1 
            ORDER BY created_at DESC 
            LIMIT 1
        `;

        const locationResult = await pool.query(locationQuery, [id]);

        // Get latest ping
        const pingQuery = `
            SELECT 
                mood,
                created_at as "updatedAt"
            FROM pings 
            WHERE user_id = $1 
            ORDER BY created_at DESC 
            LIMIT 1
        `;

        const pingResult = await pool.query(pingQuery, [id]);

        // Combine all data
        res.json({
            ...userResult.rows[0],
            items: itemsResult.rows,
            location: locationResult.rows[0] || null,
            lastPing: pingResult.rows[0] || null
        });
    } catch (err) {
        console.error('Error fetching profile:', err);
        res.status(500).json({
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

// PUT /profiles/:id
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { name, email, items } = req.body;

    // Validate UUID format
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(id)) {
        return res.status(400).json({
            error: 'Invalid id',
            details: 'Profile ID must be a valid UUID'
        });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // First check if user exists
        const userCheck = await client.query('SELECT id FROM users WHERE id = $1', [id]);
        if (userCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                error: 'User not found',
                details: `No user exists with id ${id}. Create a new user using POST /profiles first.`
            });
        }

        // Update user basic info if provided
        if (name || email) {
            const updates = [];
            const values = [];
            let valueIndex = 1;

            if (name) {
                updates.push(`name = $${valueIndex}`);
                values.push(name);
                valueIndex++;
            }
            if (email) {
                updates.push(`email = $${valueIndex}`);
                values.push(email);
                valueIndex++;
            }

            updates.push(`updated_at = CURRENT_TIMESTAMP`);
            values.push(id);

            const updateQuery = `
                UPDATE users 
                SET ${updates.join(', ')}
                WHERE id = $${valueIndex}
                RETURNING id, name, email, updated_at as "updatedAt"
            `;

            try {
                const userResult = await client.query(updateQuery, values);
                if (userResult.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return res.status(404).json({
                        error: 'Update failed',
                        details: 'User update failed'
                    });
                }
            } catch (err) {
                if (err.code === '23505' && err.constraint === 'users_email_key') {
                    await client.query('ROLLBACK');
                    return res.status(409).json({
                        error: 'Email already exists',
                        details: 'A user with this email address already exists'
                    });
                }
                throw err;
            }
        }

        // Update profile items if provided
        if (items && Array.isArray(items)) {
            // First delete existing items
            await client.query('DELETE FROM profile_items WHERE user_id = $1', [id]);

            // Then insert new items
            for (const item of items) {
                if (!item.type || !item.data) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        error: 'Invalid item format',
                        details: 'Each item must have type and data fields'
                    });
                }

                await client.query(
                    `INSERT INTO profile_items (user_id, item_type, item_data) 
                     VALUES ($1, $2, $3)`,
                    [id, item.type, item.data]
                );
            }
        }

        await client.query('COMMIT');

        // Fetch and return updated profile
        const updatedProfile = await client.query(`
            SELECT 
                u.id as "userId",
                u.email,
                u.name,
                u.updated_at as "updatedAt",
                json_agg(
                    json_build_object(
                        'id', pi.id,
                        'type', pi.item_type,
                        'data', pi.item_data,
                        'updatedAt', pi.updated_at
                    )
                ) FILTER (WHERE pi.id IS NOT NULL) as items
            FROM users u
            LEFT JOIN profile_items pi ON pi.user_id = u.id
            WHERE u.id = $1
            GROUP BY u.id, u.email, u.name, u.updated_at
        `, [id]);

        res.json(updatedProfile.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error updating profile:', err);
        res.status(500).json({
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    } finally {
        client.release();
    }
});

module.exports = router; 