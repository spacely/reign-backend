-- Update profile_items table to use correct UUID types
DO $$ 
BEGIN 
    -- First check if we need to modify the table
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'profile_items' 
        AND column_name = 'id' 
        AND data_type != 'uuid'
    ) THEN
        -- Backup existing data
        CREATE TEMP TABLE profile_items_backup AS 
        SELECT * FROM profile_items;

        -- Alter the columns to use UUID
        ALTER TABLE profile_items
        ALTER COLUMN id TYPE UUID USING id::uuid,
        ALTER COLUMN user_id TYPE UUID USING user_id::uuid;

        -- Verify the backup data
        IF EXISTS (SELECT 1 FROM profile_items_backup) THEN
            -- Clear the table to reinsert with correct types
            TRUNCATE profile_items;

            -- Reinsert the data with correct UUID types
            INSERT INTO profile_items (
                id, 
                user_id, 
                item_type, 
                item_data, 
                created_at, 
                updated_at
            )
            SELECT 
                id::uuid, 
                user_id::uuid, 
                item_type, 
                item_data, 
                created_at, 
                updated_at
            FROM profile_items_backup;
        END IF;

        -- Drop the temporary backup table
        DROP TABLE profile_items_backup;
    END IF;

    -- Ensure the index exists
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_indexes 
        WHERE tablename = 'profile_items' 
        AND indexname = 'idx_profile_items_user_id'
    ) THEN
        CREATE INDEX idx_profile_items_user_id ON profile_items(user_id);
    END IF;
END $$; 