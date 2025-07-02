-- Migration: Add support for profile images in profile_items table
-- Profile images will be stored as profile_items with item_type = 'profile_image'
-- No schema changes needed as existing JSONB structure supports this

-- Add index for efficient profile image lookups
CREATE INDEX IF NOT EXISTS idx_profile_items_type_user ON profile_items(item_type, user_id) 
WHERE item_type = 'profile_image';

-- Add comment to document the profile image format
COMMENT ON TABLE profile_items IS 'Stores user profile items including skills, education, experience, and profile images. Profile images use item_type="profile_image" with base64 data in item_data.imageData'; 