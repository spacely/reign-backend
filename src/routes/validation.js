const express = require('express');
const router = express.Router();
const { pool, enablePostGISExtensions } = require('../config/db');

// Helper function to validate UUID format
const isValidUUID = (uuid) => {
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return UUID_REGEX.test(uuid);
};

// Helper function to calculate distance using Haversine formula (in meters)
const calculateDistance = (lat1, lng1, lat2, lng2) => {
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

// Helper function to check if users are within validation range (3 meters)
const isWithinValidationRange = (lat1, lng1, lat2, lng2) => {
    const distance = calculateDistance(lat1, lng1, lat2, lng2);
    return distance <= 3; // 3 meters
};

// Helper function to get connection status between two users
const getConnectionStatus = async (client, userId1, userId2) => {
    const result = await client.query(
        `SELECT status FROM connections 
         WHERE (from_user = $1 AND to_user = $2) OR (from_user = $2 AND to_user = $1)
         LIMIT 1`,
        [userId1, userId2]
    );
    return result.rows.length > 0 ? result.rows[0].status : null;
};

// Helper function to get profile items for a user
const getProfileItems = async (client, userId) => {
    const result = await client.query(
        `SELECT item_type, item_data 
         FROM profile_items 
         WHERE user_id = $1 AND item_type != 'profile_image'`,
        [userId]
    );
    return result.rows;
};

// GET /validation/nearby - Get nearby users who can be validated
router.get('/nearby', async (req, res) => {
    const { lat, lng, radius = 0.01, userId } = req.query;

    // Validate required parameters
    if (!lat || !lng || !userId) {
        return res.status(400).json({
            error: 'Missing required parameters',
            details: 'lat, lng, and userId are required'
        });
    }

    // Validate numeric values
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    const radiusNum = parseFloat(radius);

    if (isNaN(latitude) || isNaN(longitude) || isNaN(radiusNum)) {
        return res.status(400).json({
            error: 'Invalid parameters',
            details: 'lat, lng, and radius must be valid numbers'
        });
    }

    // Validate UUID format
    if (!isValidUUID(userId)) {
        return res.status(400).json({
            error: 'Invalid userId',
            details: 'userId must be a valid UUID'
        });
    }

    // Validate coordinate ranges
    if (latitude < -90 || latitude > 90) {
        return res.status(400).json({
            error: 'Invalid latitude',
            details: 'Latitude must be between -90 and 90'
        });
    }

    if (longitude < -180 || longitude > 180) {
        return res.status(400).json({
            error: 'Invalid longitude',
            details: 'Longitude must be between -180 and 180'
        });
    }

    const client = await pool.connect();
    try {
        await enablePostGISExtensions(client);

        // Find nearby users within radius
        const nearbyUsersQuery = `
            SELECT DISTINCT
                u.id as user_id,
                u.name,
                u.email,
                l.latitude,
                l.longitude,
                COUNT(vr.id) as validation_count
            FROM users u
            JOIN locations l ON u.id = l.user_id
            LEFT JOIN validation_records vr ON u.id = vr.validated_user_id
            WHERE u.id != $1
            AND l.latitude BETWEEN $2 - $4 AND $2 + $4
            AND l.longitude BETWEEN $3 - $4 AND $3 + $4
            GROUP BY u.id, u.name, u.email, l.latitude, l.longitude
        `;

        const nearbyUsers = await client.query(nearbyUsersQuery, [userId, latitude, longitude, radiusNum]);

        const result = [];
        for (const user of nearbyUsers.rows) {
            const distance = calculateDistance(latitude, longitude, user.latitude, user.longitude);

            // Filter to users within 1km for initial filter
            if (distance <= 1000) {
                const profileItems = await getProfileItems(client, user.user_id);
                const connectionState = await getConnectionStatus(client, userId, user.user_id);

                // Only include connected users within 3 meters for validation
                if (connectionState === 'connected' && distance <= 3) {
                    result.push({
                        userId: user.user_id,
                        name: user.name,
                        email: user.email,
                        displayName: user.name || user.email,
                        latitude: user.latitude,
                        longitude: user.longitude,
                        distance: Math.round(distance),
                        profileItems,
                        connectionState,
                        validationCount: parseInt(user.validation_count)
                    });
                }
            }
        }

        res.json(result);
    } catch (error) {
        console.error('Error fetching nearby validatable users:', error);
        res.status(500).json({
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        client.release();
    }
});

// POST /validation/request - Send a validation request
router.post('/request', async (req, res) => {
    const { fromUserId, toUserId, category, specificItem } = req.body;

    // Validate required fields
    if (!fromUserId || !toUserId || !category || !specificItem) {
        return res.status(400).json({
            error: 'Missing required fields',
            details: {
                fromUserId: !fromUserId ? 'Missing fromUserId' : null,
                toUserId: !toUserId ? 'Missing toUserId' : null,
                category: !category ? 'Missing category' : null,
                specificItem: !specificItem ? 'Missing specificItem' : null
            }
        });
    }

    // Validate UUID formats
    if (!isValidUUID(fromUserId) || !isValidUUID(toUserId)) {
        return res.status(400).json({
            error: 'Invalid user ID format',
            details: 'Both fromUserId and toUserId must be valid UUIDs'
        });
    }

    // Prevent self-validation
    if (fromUserId === toUserId) {
        return res.status(400).json({
            error: 'Invalid request',
            details: 'Cannot validate yourself'
        });
    }

    // Validate category
    const validCategories = ['skills', 'education', 'experience'];
    if (!validCategories.includes(category)) {
        return res.status(400).json({
            error: 'Invalid category',
            details: `Category must be one of: ${validCategories.join(', ')}`
        });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Verify both users exist
        const usersCheck = await client.query(
            'SELECT id FROM users WHERE id IN ($1, $2)',
            [fromUserId, toUserId]
        );

        if (usersCheck.rows.length !== 2) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                error: 'User not found',
                details: 'One or both users do not exist'
            });
        }

        // Check connection status
        const connectionState = await getConnectionStatus(client, fromUserId, toUserId);
        if (connectionState !== 'connected') {
            await client.query('ROLLBACK');
            return res.status(403).json({
                error: 'Users not connected',
                details: 'Users must be connected to request validation'
            });
        }

        // Check proximity using latest locations
        const locationsQuery = `
            SELECT user_id, latitude, longitude 
            FROM locations 
            WHERE user_id IN ($1, $2)
            ORDER BY created_at DESC
        `;
        const locations = await client.query(locationsQuery, [fromUserId, toUserId]);

        if (locations.rows.length !== 2) {
            await client.query('ROLLBACK');
            return res.status(422).json({
                error: 'Location data not available',
                details: 'Both users must have location data for validation'
            });
        }

        const fromUserLocation = locations.rows.find(l => l.user_id === fromUserId);
        const toUserLocation = locations.rows.find(l => l.user_id === toUserId);

        if (!isWithinValidationRange(
            fromUserLocation.latitude, fromUserLocation.longitude,
            toUserLocation.latitude, toUserLocation.longitude
        )) {
            await client.query('ROLLBACK');
            return res.status(422).json({
                error: 'Users too far apart',
                details: 'Users must be within 3 meters for validation'
            });
        }

        // Verify the specific item exists in target user's profile
        const itemCheck = await client.query(
            `SELECT 1 FROM profile_items 
             WHERE user_id = $1 AND item_type = $2 
             AND item_data::text ILIKE $3`,
            [toUserId, category === 'skills' ? 'skill' : category, `%${specificItem}%`]
        );

        if (itemCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(422).json({
                error: 'Item not found',
                details: `The specified ${category} item was not found in the target user's profile`
            });
        }

        // Check for existing validation request or record
        const existingRequest = await client.query(
            `SELECT id FROM validation_requests 
             WHERE from_user_id = $1 AND to_user_id = $2 
             AND category = $3 AND specific_item = $4
             AND status = 'pending'`,
            [fromUserId, toUserId, category, specificItem]
        );

        if (existingRequest.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: 'Duplicate request',
                details: 'A validation request for this item already exists'
            });
        }

        const existingValidation = await client.query(
            `SELECT id FROM validation_records 
             WHERE validated_user_id = $1 AND validator_user_id = $2 
             AND category = $3 AND specific_item = $4`,
            [toUserId, fromUserId, category, specificItem]
        );

        if (existingValidation.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: 'Already validated',
                details: 'This item has already been validated by you'
            });
        }

        // Create validation request
        const requestResult = await client.query(
            `INSERT INTO validation_requests (from_user_id, to_user_id, category, specific_item)
             VALUES ($1, $2, $3, $4)
             RETURNING id`,
            [fromUserId, toUserId, category, specificItem]
        );

        await client.query('COMMIT');

        res.status(201).json({
            requestId: requestResult.rows[0].id,
            message: 'Validation request sent successfully'
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error creating validation request:', error);

        if (error.code === '23505') { // Unique violation
            res.status(409).json({
                error: 'Duplicate request',
                details: 'A validation request for this item already exists'
            });
        } else {
            res.status(500).json({
                error: 'Internal server error',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    } finally {
        client.release();
    }
});

// POST /validation/respond - Respond to a validation request
router.post('/respond', async (req, res) => {
    const { requestId, response } = req.body;

    // Validate required fields
    if (!requestId || !response) {
        return res.status(400).json({
            error: 'Missing required fields',
            details: {
                requestId: !requestId ? 'Missing requestId' : null,
                response: !response ? 'Missing response' : null
            }
        });
    }

    // Validate UUID format
    if (!isValidUUID(requestId)) {
        return res.status(400).json({
            error: 'Invalid requestId',
            details: 'requestId must be a valid UUID'
        });
    }

    // Validate response value
    if (!['approved', 'declined'].includes(response)) {
        return res.status(400).json({
            error: 'Invalid response',
            details: 'Response must be either "approved" or "declined"'
        });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Find the validation request
        const requestQuery = `
            SELECT vr.*, u1.name as from_user_name, u2.name as to_user_name
            FROM validation_requests vr
            JOIN users u1 ON vr.from_user_id = u1.id
            JOIN users u2 ON vr.to_user_id = u2.id
            WHERE vr.id = $1
        `;
        const requestResult = await client.query(requestQuery, [requestId]);

        if (requestResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                error: 'Request not found',
                details: 'Validation request not found'
            });
        }

        const request = requestResult.rows[0];

        // Check if request is still pending
        if (request.status !== 'pending') {
            await client.query('ROLLBACK');
            return res.status(410).json({
                error: 'Request no longer pending',
                details: `Request status is ${request.status}`
            });
        }

        // Check if request has expired
        if (new Date() > new Date(request.expires_at)) {
            await client.query('ROLLBACK');
            return res.status(410).json({
                error: 'Request expired',
                details: 'This validation request has expired'
            });
        }

        // Update request status
        await client.query(
            `UPDATE validation_requests 
             SET status = $1, updated_at = CURRENT_TIMESTAMP 
             WHERE id = $2`,
            [response, requestId]
        );

        // If approved, create validation record
        if (response === 'approved') {
            await client.query(
                `INSERT INTO validation_records (
                    validated_user_id, validator_user_id, category, 
                    specific_item, validation_request_id
                ) VALUES ($1, $2, $3, $4, $5)`,
                [
                    request.to_user_id,
                    request.from_user_id,
                    request.category,
                    request.specific_item,
                    requestId
                ]
            );
        }

        await client.query('COMMIT');

        res.json({
            message: `Validation request ${response} successfully`
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error responding to validation request:', error);
        res.status(500).json({
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        client.release();
    }
});

// GET /validation/pending/:userId - Get pending validation requests for a user
router.get('/pending/:userId', async (req, res) => {
    const { userId } = req.params;

    // Validate UUID format
    if (!isValidUUID(userId)) {
        return res.status(400).json({
            error: 'Invalid userId',
            details: 'userId must be a valid UUID'
        });
    }

    const client = await pool.connect();
    try {
        // Check if user exists
        const userCheck = await client.query('SELECT id FROM users WHERE id = $1', [userId]);
        if (userCheck.rows.length === 0) {
            return res.status(404).json({
                error: 'User not found',
                details: `No user exists with id ${userId}`
            });
        }

        // Get pending validation requests
        const requestsQuery = `
            SELECT 
                vr.id,
                vr.from_user_id as "fromUserId",
                vr.category,
                vr.specific_item as "specificItem",
                vr.created_at as "createdAt",
                vr.expires_at as "expiresAt",
                u.name as "requesterName",
                u.email as "requesterEmail"
            FROM validation_requests vr
            JOIN users u ON vr.from_user_id = u.id
            WHERE vr.to_user_id = $1 
            AND vr.status = 'pending'
            AND vr.expires_at > CURRENT_TIMESTAMP
            ORDER BY vr.created_at DESC
        `;

        const result = await client.query(requestsQuery, [userId]);

        // Transform results to include display name
        const transformedResults = result.rows.map(row => ({
            ...row,
            requesterDisplayName: row.requesterName || row.requesterEmail
        }));

        res.json(transformedResults);
    } catch (error) {
        console.error('Error fetching pending validation requests:', error);
        res.status(500).json({
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        client.release();
    }
});

// GET /validation/summary/:userId - Get validation summary for a user
router.get('/summary/:userId', async (req, res) => {
    const { userId } = req.params;

    // Validate UUID format
    if (!isValidUUID(userId)) {
        return res.status(400).json({
            error: 'Invalid userId',
            details: 'userId must be a valid UUID'
        });
    }

    const client = await pool.connect();
    try {
        // Check if user exists
        const userCheck = await client.query('SELECT id FROM users WHERE id = $1', [userId]);
        if (userCheck.rows.length === 0) {
            return res.status(404).json({
                error: 'User not found',
                details: `No user exists with id ${userId}`
            });
        }

        // Get total validation count
        const totalQuery = `
            SELECT COUNT(*) as total_validations
            FROM validation_records 
            WHERE validated_user_id = $1
        `;
        const totalResult = await client.query(totalQuery, [userId]);

        // Get validation count by category
        const categoryQuery = `
            SELECT 
                category,
                COUNT(*) as count
            FROM validation_records 
            WHERE validated_user_id = $1
            GROUP BY category
        `;
        const categoryResult = await client.query(categoryQuery, [userId]);

        // Get validation count by specific item
        const itemQuery = `
            SELECT 
                category,
                specific_item,
                COUNT(*) as count
            FROM validation_records 
            WHERE validated_user_id = $1
            GROUP BY category, specific_item
            ORDER BY category, count DESC
        `;
        const itemResult = await client.query(itemQuery, [userId]);

        // Build category summary
        const validCategories = ['skills', 'education', 'experience'];
        const categoryBreakdown = {};
        validCategories.forEach(cat => {
            categoryBreakdown[cat] = 0;
        });

        categoryResult.rows.forEach(row => {
            categoryBreakdown[row.category] = parseInt(row.count);
        });

        // Build item breakdown
        const itemBreakdown = {};
        itemResult.rows.forEach(row => {
            if (!itemBreakdown[row.category]) {
                itemBreakdown[row.category] = [];
            }
            itemBreakdown[row.category].push({
                item: row.specific_item,
                validationCount: parseInt(row.count)
            });
        });

        res.json({
            userId,
            totalValidations: parseInt(totalResult.rows[0].total_validations),
            categoryBreakdown,
            itemBreakdown
        });
    } catch (error) {
        console.error('Error fetching validation summary:', error);
        res.status(500).json({
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        client.release();
    }
});

module.exports = router; 