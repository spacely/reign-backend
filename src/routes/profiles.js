const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');

// Validate category helper function
const isValidCategory = (category) => ['skill', 'education', 'experience'].includes(category);

// Validate profile image helper function
const validateProfileImage = (imageData) => {
    if (!imageData || typeof imageData !== 'string') {
        return { valid: false, error: 'Profile image must be a string' };
    }

    // Check JPEG format
    if (!imageData.startsWith('data:image/jpeg;base64,')) {
        return { valid: false, error: 'Profile image must be in JPEG format (data:image/jpeg;base64,...)' };
    }

    // Extract base64 data and validate format
    const base64Data = imageData.split(',')[1];
    if (!base64Data) {
        return { valid: false, error: 'Invalid base64 format' };
    }

    // Validate base64 format
    const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
    if (!base64Regex.test(base64Data)) {
        return { valid: false, error: 'Invalid base64 encoding' };
    }

    // Check size (2MB limit)
    const sizeInBytes = (base64Data.length * 3) / 4;
    const maxSize = 2 * 1024 * 1024; // 2MB
    if (sizeInBytes > maxSize) {
        return { valid: false, error: 'Profile image size exceeds 2MB limit' };
    }

    return { valid: true };
};

// Helper function to get profile image for a user
const getProfileImage = async (client, userId) => {
    const imageQuery = `
        SELECT item_data->'imageData' as image_data
        FROM profile_items 
        WHERE user_id = $1 AND item_type = 'profile_image'
        ORDER BY created_at DESC 
        LIMIT 1
    `;
    const imageResult = await client.query(imageQuery, [userId]);
    return imageResult.rows.length > 0 ? imageResult.rows[0].image_data : null;
};

// Helper function to save profile image
const saveProfileImage = async (client, userId, imageData) => {
    // First delete any existing profile image
    await client.query(
        'DELETE FROM profile_items WHERE user_id = $1 AND item_type = $2',
        [userId, 'profile_image']
    );

    // Insert new profile image
    await client.query(
        `INSERT INTO profile_items (user_id, item_type, item_data) 
         VALUES ($1, $2, $3)`,
        [userId, 'profile_image', JSON.stringify({ imageData })]
    );
};

// POST /profiles - Create a new user
router.post('/', async (req, res) => {
    const { email, name, profileItems: items, profileImageData } = req.body;

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

    // Validate profile image if provided
    if (profileImageData) {
        const imageValidation = validateProfileImage(profileImageData);
        if (!imageValidation.valid) {
            return res.status(400).json({
                error: 'Invalid profile image',
                details: imageValidation.error
            });
        }
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

        // Save profile image if provided
        if (profileImageData) {
            await saveProfileImage(client, userId, profileImageData);
        }

        await client.query('COMMIT');

        // Get profile image for response
        const profileImage = profileImageData || null;

        res.status(201).json({
            status: 'ok',
            message: 'Profile created successfully',
            data: {
                user: userResult.rows[0],
                profileItems: profileItems,
                profileImage: profileImage
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

    const client = await pool.connect();
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

        const userResult = await client.query(userQuery, [id]);

        if (userResult.rows.length === 0) {
            return res.status(404).json({
                error: 'User not found',
                details: `No user exists with id ${id}`
            });
        }

        // Get profile items (excluding profile images)
        const itemsQuery = `
            SELECT 
                id,
                item_type as "itemType",
                item_data as "itemData",
                created_at as "createdAt",
                updated_at as "updatedAt"
            FROM profile_items 
            WHERE user_id = $1 AND item_type != 'profile_image'
            ORDER BY created_at DESC
        `;

        const itemsResult = await client.query(itemsQuery, [id]);

        // Get profile image separately
        const profileImage = await getProfileImage(client, id);

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

        const locationResult = await client.query(locationQuery, [id]);

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

        const pingResult = await client.query(pingQuery, [id]);

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

        const badgesResult = await client.query(badgesQuery, [id]);

        // Combine all data
        const response = {
            ...userResult.rows[0],
            profileItems: itemsResult.rows,
            location: locationResult.rows[0] || null,
            lastPing: pingResult.rows[0] || null,
            moodBadges: badgesResult.rows
        };

        // Add profile image if it exists
        if (profileImage) {
            response.profileImage = profileImage;
        }

        res.json(response);
    } catch (err) {
        console.error('Error fetching profile:', err);
        res.status(500).json({
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    } finally {
        client.release();
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

    const client = await pool.connect();
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

        const userResult = await client.query(userQuery, [email]);

        if (userResult.rows.length === 0) {
            return res.status(404).json({
                error: 'User not found',
                details: `No user exists with email ${email}`
            });
        }

        const userId = userResult.rows[0].userId;

        // Get profile items (excluding profile images)
        const itemsQuery = `
            SELECT 
                id,
                item_type as "itemType",
                item_data as "itemData",
                created_at as "createdAt",
                updated_at as "updatedAt"
            FROM profile_items 
            WHERE user_id = $1 AND item_type != 'profile_image'
            ORDER BY created_at DESC
        `;

        const itemsResult = await client.query(itemsQuery, [userId]);

        // Get profile image separately
        const profileImage = await getProfileImage(client, userId);

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

        const locationResult = await client.query(locationQuery, [userId]);

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

        const pingResult = await client.query(pingQuery, [userId]);

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

        const badgesResult = await client.query(badgesQuery, [userId]);

        // Combine all data
        const response = {
            ...userResult.rows[0],
            profileItems: itemsResult.rows,
            location: locationResult.rows[0] || null,
            lastPing: pingResult.rows[0] || null,
            moodBadges: badgesResult.rows
        };

        // Add profile image if it exists
        if (profileImage) {
            response.profileImage = profileImage;
        }

        res.json(response);
    } catch (err) {
        console.error('Error fetching profile by email:', err);
        res.status(500).json({
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    } finally {
        client.release();
    }
});

// PUT /profiles/:id
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { name, email, profileItems: items, moodBadges, profileImageData } = req.body;

    // Validate UUID format
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(id)) {
        return res.status(400).json({
            error: 'Invalid id',
            details: 'Profile ID must be a valid UUID'
        });
    }

    // Validate profile image if provided
    if (profileImageData) {
        const imageValidation = validateProfileImage(profileImageData);
        if (!imageValidation.valid) {
            return res.status(400).json({
                error: 'Invalid profile image',
                details: imageValidation.error
            });
        }
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

        // Update profile items if provided (excluding profile images)
        const profileItems = [];
        if (items && Array.isArray(items)) {
            // First delete existing items (excluding profile images)
            await client.query('DELETE FROM profile_items WHERE user_id = $1 AND item_type != $2', [id, 'profile_image']);

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

        // Update profile image if provided
        if (profileImageData) {
            await saveProfileImage(client, id, profileImageData);
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

        // Get updated profile image
        const profileImage = await getProfileImage(client, id);

        const response = {
            ...updatedProfile.rows[0],
            profileItems: profileItems,
            moodBadges: savedMoodBadges
        };

        // Add profile image if it exists
        if (profileImage) {
            response.profileImage = profileImage;
        }

        res.json(response);
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