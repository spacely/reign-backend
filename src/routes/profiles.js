const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');

// POST /profiles - Create a new user
router.post('/', async (req, res) => {
    const { email, name, profileItems: items } = req.body;

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

        // Check if email already exists
        const existingUserResult = await client.query(
            'SELECT id FROM users WHERE email = $1',
            [email]
        );

        if (existingUserResult.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: 'Email already exists',
                userId: existingUserResult.rows[0].id,
                details: 'A user with this email already exists. Use PUT /profiles/:id to update the profile.'
            });
        }

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
                // Support both formats: type/data and item_type/item_data
                const itemType = item.type || item.item_type;
                const itemData = item.data || item.item_data;

                if (!itemType || !itemData) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        error: 'Invalid profile item',
                        details: 'Each profile item must have either type/data or item_type/item_data fields'
                    });
                }

                const itemResult = await client.query(
                    `INSERT INTO profile_items (user_id, item_type, item_data)
                     VALUES ($1, $2, $3)
                     RETURNING id, item_type, item_data, created_at as "createdAt"`,
                    [userId, itemType, JSON.stringify(itemData)]
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
                profileItems: profileItems
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

        // Get mood badges
        const badgesQuery = `
            SELECT 
                id,
                mood,
                category,
                value,
                created_at as "createdAt"
            FROM mood_badges 
            WHERE user_id = $1 
            ORDER BY created_at DESC
        `;

        const badgesResult = await pool.query(badgesQuery, [id]);

        // Combine all data
        res.json({
            ...userResult.rows[0],
            profileItems: itemsResult.rows,
            location: locationResult.rows[0] || null,
            lastPing: pingResult.rows[0] || null,
            moodBadges: badgesResult.rows
        });
    } catch (err) {
        console.error('Error fetching profile:', err);
        res.status(500).json({
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

// GET /profiles/by-email/:email
router.get('/by-email/:email', async (req, res) => {
    const { email } = req.params;

    // Validate email format
    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!EMAIL_REGEX.test(email)) {
        return res.status(400).json({
            error: 'Invalid email',
            details: 'Please provide a valid email address'
        });
    }

    try {
        // Get user profile by email
        const userQuery = `
            SELECT 
                u.id as "userId",
                u.email,
                u.name,
                u.created_at as "createdAt",
                u.updated_at as "updatedAt"
            FROM users u
            WHERE u.email = $1
        `;

        const userResult = await pool.query(userQuery, [email]);

        if (userResult.rows.length === 0) {
            return res.status(404).json({
                error: 'User not found',
                details: `No user exists with email ${email}`
            });
        }

        const userId = userResult.rows[0].userId;

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

        const itemsResult = await pool.query(itemsQuery, [userId]);

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

        const locationResult = await pool.query(locationQuery, [userId]);

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

        const pingResult = await pool.query(pingQuery, [userId]);

        // Get mood badges
        const badgesQuery = `
            SELECT 
                id,
                mood,
                category,
                value,
                created_at as "createdAt"
            FROM mood_badges 
            WHERE user_id = $1 
            ORDER BY created_at DESC
        `;

        const badgesResult = await pool.query(badgesQuery, [userId]);

        // Combine all data
        res.json({
            ...userResult.rows[0],
            profileItems: itemsResult.rows,
            location: locationResult.rows[0] || null,
            lastPing: pingResult.rows[0] || null,
            moodBadges: badgesResult.rows
        });
    } catch (err) {
        console.error('Error fetching profile by email:', err);
        res.status(500).json({
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

// PUT /profiles/:id
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { name, email, profileItems: items, moodBadges } = req.body;

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
        const profileItems = [];
        if (items && Array.isArray(items)) {
            // First delete existing items
            await client.query('DELETE FROM profile_items WHERE user_id = $1', [id]);

            // Then insert new items
            for (const item of items) {
                // Support both formats: type/data and item_type/item_data
                const itemType = item.type || item.item_type;
                const itemData = item.data || item.item_data;

                if (!itemType || !itemData) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        error: 'Invalid item format',
                        details: 'Each item must have either type/data or item_type/item_data fields'
                    });
                }

                const itemResult = await client.query(
                    `INSERT INTO profile_items (user_id, item_type, item_data) 
                     VALUES ($1, $2, $3)
                     RETURNING id, item_type as "type", item_data as "data", created_at as "createdAt", updated_at as "updatedAt"`,
                    [id, itemType, JSON.stringify(itemData)]
                );
                profileItems.push(itemResult.rows[0]);
            }
        }

        // Update mood badges if provided
        const savedMoodBadges = [];
        if (Array.isArray(moodBadges)) {
            // First delete existing mood badges
            await client.query('DELETE FROM mood_badges WHERE user_id = $1', [id]);

            if (moodBadges.length > 0) {
                // Validate each mood badge
                for (const badge of moodBadges) {
                    if (!badge.mood || !badge.category || !badge.value) {
                        await client.query('ROLLBACK');
                        return res.status(400).json({
                            error: 'Invalid mood badge format',
                            details: 'Each mood badge must have mood, category, and value fields'
                        });
                    }

                    // Insert new mood badge
                    const badgeResult = await client.query(
                        `INSERT INTO mood_badges (user_id, mood, category, value) 
                         VALUES ($1, $2, $3, $4)
                         RETURNING id, mood, category, value, created_at as "createdAt"`,
                        [id, badge.mood, badge.category, badge.value]
                    );
                    savedMoodBadges.push(badgeResult.rows[0]);
                }
            }
        }

        await client.query('COMMIT');

        // Fetch and return updated profile
        const updatedProfile = await client.query(`
            SELECT 
                u.id as "userId",
                u.email,
                u.name,
                u.updated_at as "updatedAt"
            FROM users u
            WHERE u.id = $1
        `, [id]);

        res.json({
            ...updatedProfile.rows[0],
            profileItems: profileItems,
            moodBadges: savedMoodBadges
        });
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