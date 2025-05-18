-- Recreate profile_items table with correct UUID types
DO $$ 
BEGIN 
    -- Drop the existing table if it exists
    DROP TABLE IF EXISTS profile_items;

    -- Recreate the table with correct UUID types
    CREATE TABLE profile_items (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL,
        item_type VARCHAR(50) NOT NULL,
        item_data JSONB NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT profile_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Recreate indexes
    CREATE INDEX idx_profile_items_user_id ON profile_items(user_id);
END $$; 