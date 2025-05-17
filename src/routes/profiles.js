const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// GET /profiles/:id
router.get('/:id', async (req, res) => {
    try {
        // TODO: Replace with actual database query
        const mockProfile = {
            id: req.params.id,
            email: `user${req.params.id}@example.com`,
            items: [
                {
                    type: 'bio',
                    data: {
                        text: 'Mock biography text'
                    }
                },
                {
                    type: 'interests',
                    data: {
                        items: ['coding', 'reading', 'traveling']
                    }
                }
            ]
        };

        res.json(mockProfile);
    } catch (err) {
        console.error('Error fetching profile:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router; 