-- Connect to the database
\c users_db;

-- Create students table
CREATE TABLE IF NOT EXISTS students (
    student_id SERIAL PRIMARY KEY,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(100) NOT NULL,
    profile_photo VARCHAR(255),
    bio TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Index to optimize email lookups
CREATE INDEX IF NOT EXISTS idx_students_email ON students(email);

-- Create website_settings table
CREATE TABLE IF NOT EXISTS website_settings (
    id SERIAL PRIMARY KEY,
    theme VARCHAR(50) DEFAULT 'light',
    language VARCHAR(10) DEFAULT 'en'
);

-- Ensure there's always one row in website_settings
INSERT INTO website_settings (id)
SELECT 1
WHERE NOT EXISTS (SELECT 1 FROM website_settings);

-- Create posts table for the social feature
CREATE TABLE IF NOT EXISTS posts (
    post_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    image_url VARCHAR(255) NOT NULL,
    caption TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Optional: Create index on posts.user_id for performance
CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);

-- Create likes table to track which user liked which post.
CREATE TABLE IF NOT EXISTS likes (
    like_id SERIAL PRIMARY KEY,
    post_id INTEGER NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (post_id, user_id)  -- Ensures a user can like a post only once.
);

-- Create comments table to store comments on posts.
CREATE TABLE IF NOT EXISTS comments (
    comment_id SERIAL PRIMARY KEY,
    post_id INTEGER NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    comment TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
