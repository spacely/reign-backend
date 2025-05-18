-- Update locations table constraints
DO $$ 
BEGIN 
    -- Add UNIQUE constraint if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_constraint 
        WHERE conname = 'unique_user_location'
    ) THEN 
        ALTER TABLE locations
        ADD CONSTRAINT unique_user_location UNIQUE (user_id);
    END IF;

    -- Ensure created_at has DEFAULT NOW()
    ALTER TABLE locations
    ALTER COLUMN created_at SET DEFAULT NOW();
END $$; 