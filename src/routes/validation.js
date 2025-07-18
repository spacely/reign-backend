const express = require('express');
const router = express.Router();
const { pool, enablePostGISExtensions } = require('../config/db');

// Helper function to validate UUID format
const isValidUUID = (uuid) => {
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return UUID_REGEX.test(uuid);
};

// Distance calculation removed - proximity no longer required for validation

// Note: Proximity validation removed - users only need to be connected

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

// GET /validation/nearby - Get connected users who can be validated
router.get('/nearby', async (req, res) => {
    const { userId } = req.query;

    // Validate required parameters
    if (!userId) {
        return res.status(400).json({
            error: 'Missing required parameters',
            details: 'userId is required'
        });
    }

    // Validate UUID format
    if (!isValidUUID(userId)) {
        return res.status(400).json({
            error: 'Invalid userId',
            details: 'userId must be a valid UUID'
        });
    }

    const client = await pool.connect();
    try {
        // Find all connected users
        const connectedUsersQuery = `
            SELECT DISTINCT
                u.id as user_id,
                u.name,
                u.email,
                COUNT(vr.id) as validation_count
            FROM users u
            JOIN connections c ON (
                (c.from_user = $1 AND c.to_user = u.id) OR 
                (c.to_user = $1 AND c.from_user = u.id)
            )
            LEFT JOIN validation_records vr ON u.id = vr.validated_user_id
            WHERE u.id != $1
            AND c.status = 'connected'
            GROUP BY u.id, u.name, u.email
        `;

        const connectedUsers = await client.query(connectedUsersQuery, [userId]);

        const result = [];
        for (const user of connectedUsers.rows) {
            const profileItems = await getProfileItems(client, user.user_id);

            result.push({
                userId: user.user_id,
                name: user.name,
                email: user.email,
                displayName: user.name || user.email,
                profileItems,
                connectionState: 'connected',
                validationCount: parseInt(user.validation_count)
            });
        }

        res.json(result);
    } catch (error) {
        console.error('Error fetching connected validatable users:', error);
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

        // No proximity check needed - connection is sufficient

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

        // Create validation request - let database handle ID generation
        const requestResult = await client.query(
            `INSERT INTO validation_requests (from_user_id, to_user_id, category, specific_item)
             VALUES ($1, $2, $3, $4)
             RETURNING id, created_at`,
            [fromUserId, toUserId, category, specificItem]
        );

        await client.query('COMMIT');

        res.status(201).json({
            requestId: requestResult.rows[0].id,
            createdAt: requestResult.rows[0].created_at,
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