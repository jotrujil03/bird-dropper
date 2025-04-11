// Dependencies
const express = require('express');
const app = express();
const handlebars = require('express-handlebars');
const path = require('path');
const pgp = require('pg-promise')();
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, 'resources/uploads')); // Ensure this directory exists
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// App Configuration and Handlebars Setup
const hbs = handlebars.create({
  extname: 'hbs',
  layoutsDir: path.join(__dirname, 'views/layouts'),
  partialsDir: path.join(__dirname, 'views/partials'),
  helpers: {
    ifEquals: function (arg1, arg2, options) {
      return arg1 == arg2 ? options.fn(this) : options.inverse(this);
    },
    eq: function (arg1, arg2) {
      return arg1 == arg2;
    },
    formatDate: function (datetime) {
      if (!datetime) return '';
      const date = new Date(datetime);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
  }
});
app.engine('hbs', hbs.engine);
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'resources')));

// Session Configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    saveUninitialized: false,
    resave: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      httpOnly: true
    }
  })
);

// Share user data with all views
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

// Middleware: Protect routes
const auth = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
};

// Database Configuration
const dbConfig = {
  host: 'db',
  port: 5432,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD
};
const db = pgp(dbConfig);

// Test DB Connection and Create Admin User (if needed)
db.connect()
  .then(obj => {
    console.log('Database connection successful');
    obj.done();

    async function createAdminUser() {
      const adminEmail = 'admin@admin.com';
      const adminUsername = 'admin';
      const adminPassword = process.env.ADMIN_PASSWORD;

      try {
        const existingAdmin = await db.oneOrNone('SELECT student_id FROM students WHERE email = $1', [adminEmail]);

        if (!existingAdmin) {
          const salt = await bcrypt.genSalt(10);
          const hashedPassword = await bcrypt.hash(adminPassword, salt);

          const newAdmin = await db.one(
            `INSERT INTO students (first_name, last_name, email, username, password, profile_photo)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING student_id`,
            ['Admin', 'User', adminEmail, adminUsername, hashedPassword, '']
          );

          console.log('Admin user created successfully:', newAdmin.student_id);
        } else {
          console.log('Admin user already exists.');
        }
      } catch (error) {
        console.error('Error creating admin user:', error);
      }
    }

    createAdminUser();
  })
  .catch(error => {
    console.log('ERROR:', error.message || error);
  });

// Registration Routes
app.get('/register', (req, res) => {
  res.render('pages/register', { title: 'Register' });
});

app.post('/register', async (req, res) => {
  const { first_name, last_name, email, username, password, confirm_password } = req.body;
  const formData = { first_name, last_name, email, username };

  if (password !== confirm_password) {
    return res.render('pages/register', {
      title: 'Register',
      error: 'Passwords do not match',
      formData
    });
  }

  try {
    const salt = bcrypt.genSaltSync(10);
    const hashedPassword = bcrypt.hashSync(password, salt);

    const newUser = await db.one(
      `INSERT INTO students
       (first_name, last_name, email, username, password, profile_photo)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING student_id, username, email, first_name, last_name, created_at, profile_photo`,
      [first_name, last_name, email, username, hashedPassword, '']
    );

    // If no profile photo is set, fallback to default image
    req.session.user = {
      id: newUser.student_id,
      username: newUser.username,
      email: newUser.email,
      first_name: newUser.first_name,
      last_name: newUser.last_name,
      created_at: newUser.created_at,
      profileImage: newUser.profile_photo || '/images/cardinal-bird-branch.jpg'
    };

    res.redirect('/profile');
  } catch (err) {
    let error = 'Registration failed. Please try again.';
    if (err.code === '23505') {
      if (err.constraint === 'students_email_key') error = 'Email already in use';
      if (err.constraint === 'students_username_key') error = 'Username already taken';
    }
    res.render('pages/register', { title: 'Register', error, formData });
  }
});

// Handle new post submission
app.post('/post', auth, upload.single('photo'), async (req, res) => {
  const { caption } = req.body;
  const userId = req.session.user.id;

  if (!req.file) {
    return res.status(400).send('No image uploaded.');
  }

  const imageUrl = `/uploads/${req.file.filename}`;

  try {
    await db.none(
      `INSERT INTO posts (user_id, image_url, caption, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [userId, imageUrl, caption]
    );

    res.redirect('/social');
  } catch (error) {
    console.error('Error saving post:', error);
    res.status(500).send('Error saving your post.');
  }
});

// Delete post route (using post_id)
app.post('/delete-post/:id', auth, async (req, res) => {
  const postId = req.params.id;
  const userId = req.session.user.id;

  try {
    // Ensure the post belongs to the logged-in user using post_id
    const post = await db.oneOrNone(
      'SELECT post_id FROM posts WHERE post_id = $1 AND user_id = $2',
      [postId, userId]
    );

    if (!post) {
      return res.status(403).send('Unauthorized to delete this post.');
    }

    await db.none('DELETE FROM posts WHERE post_id = $1', [postId]);

    res.redirect('/social');
  } catch (err) {
    console.error('Error deleting post:', err);
    res.status(500).send('Failed to delete post.');
  }
});

// Social route (updated to include user id in each post object)
app.get('/social', auth, async (req, res) => {
  try {
    const posts = await db.any(
      `SELECT p.*, s.username, s.profile_photo AS avatar, p.user_id
       FROM posts p
       JOIN students s ON p.user_id = s.student_id
       ORDER BY p.created_at DESC`
    );

    const formattedPosts = posts.map(post => ({
      id: post.post_id, // for delete action
      imageUrl: post.image_url,
      caption: post.caption,
      createdAt: post.created_at,
      likes: 0, // Placeholder for future like feature
      comments: [], // Placeholder for future comments
      user: {
        id: post.user_id, // Added author id for robust comparison
        username: post.username,
        avatar: post.avatar || '/images/cardinal-bird-branch.jpg'
      }
    }));

    res.render('pages/social', {
      title: 'Social',
      user: req.session.user,
      posts: formattedPosts
    });
  } catch (err) {
    console.error('Error loading social feed:', err);
    res.render('pages/social', {
      title: 'Social',
      posts: [],
      error: 'Could not load posts at this time.'
    });
  }
});

// Home route
app.get('/', async (req, res) => {
  try {
    const websiteSettings = await db.oneOrNone(
      'SELECT theme, language FROM website_settings WHERE id = 1'
    );
    const theme = websiteSettings ? websiteSettings.theme : 'light';
    const language = websiteSettings ? websiteSettings.language : 'en';

    res.render('pages/home', {
      title: 'Home',
      user: req.session.user,
      theme: theme,
      language: language
    });
  } catch (error) {
    console.error('Error fetching website settings:', error);
    res.render('pages/home', {
      title: 'Home',
      user: req.session.user,
      theme: 'light',
      language: 'en'
    });
  }
});

// Login Routes
app.get('/login', (req, res) => {
  res.render('pages/login', { title: 'Login' });
});
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await db.oneOrNone(
      `SELECT student_id, email, username, first_name, last_name, password, profile_photo
       FROM students
       WHERE email = $1`,
      [email]
    );

    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.render('pages/login', {
        title: 'Login',
        error: 'Invalid email or password',
        formData: { email }
      });
    }

    req.session.user = {
      id: user.student_id,
      email: user.email,
      username: user.username,
      first_name: user.first_name,
      last_name: user.last_name,
      profileImage: user.profile_photo || '/images/cardinal-bird-branch.jpg'
    };

    res.redirect('/profile');
  } catch (err) {
    console.error('Login error:', err);
    res.render('pages/login', {
      title: 'Login',
      error: 'Login failed. Please try again.',
      formData: { email }
    });
  }
});

// Profile Route
app.get('/profile', auth, async (req, res) => {
  try {
    const student = await db.one(
      'SELECT student_id, first_name, last_name, email, username, bio, created_at, profile_photo FROM students WHERE student_id = $1',
      [req.session.user.id]
    );

    req.session.user.bio = student.bio;

    res.render('pages/profile', {
      title: 'Your Profile',
      user: student,
      profileImage: student.profile_photo || '/images/cardinal-bird-branch.jpg',
      bio: student.bio
    });
  } catch (error) {
    console.error('Error fetching profile:', error);
    const profileImage = req.session.user.profileImage ? req.session.user.profileImage : '/images/cardinal-bird-branch.jpg';
    res.render('pages/profile', {
      title: 'Your Profile',
      user: req.session.user,
      profileImage,
      error: 'Unable to load complete profile data'
    });
  }
});

app.post('/edit-profile', auth, async (req, res) => {
  console.log("POST /edit-profile route reached");
  const { bio } = req.body;
  const userId = req.session.user.id;

  try {
    await db.none('UPDATE students SET bio = $1 WHERE student_id = $2', [bio, userId]);
    req.session.user.bio = bio;
    res.redirect('/profile');
  } catch (error) {
    console.error('Error updating profile:', error);
    res.render('pages/profile', {
      title: 'Your Profile',
      user: req.session.user,
      error: 'Failed to update your profile. Please try again.'
    });
  }
});

// Settings Route
app.get('/settings', (req, res) => {
  res.render('pages/settings', {
    title: 'Settings'
  });
});

// Search Route
app.get('/search', (req, res) => {
  res.render('pages/search', {
    title: 'Search'
  });
});

// Logout Route
app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) console.log('Session destruction error:', err);
    res.clearCookie('connect.sid');
    res.render('pages/logout', { title: 'Logging Out' });
  });
});

// API endpoint for saving website settings
app.post('/settings/website', async (req, res) => {
  const { theme, language } = req.body;

  try {
    await db.none(
      `UPDATE website_settings
       SET theme = $1, language = $2
       WHERE id = 1`,
      [theme, language]
    );

    console.log('Website settings saved:', { theme, language });
    res.json({ message: 'Website settings saved successfully' });
  } catch (error) {
    console.error('Error saving website settings:', error);
    res.status(500).json({ error: 'Failed to save website settings' });
  }
});

app.post('/update-profile-image', auth, upload.single('profileImage'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded.' });
  }

  try {
    const userId = req.session.user.id;
    const profileImageURL = `/uploads/${req.file.filename}`;
    await db.query('UPDATE students SET profile_photo = $1 WHERE student_id = $2', [profileImageURL, userId]);
    req.session.user.profileImage = profileImageURL;
    res.json({ success: true, profileImage: profileImageURL });
  } catch (err) {
    console.error('Error updating profile picture:', err);
    res.status(500).json({ success: false, error: 'Failed to update profile picture.' });
  }
});

// API endpoint for saving user-specific settings
app.post('/settings/user', auth, async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const userId = req.session.user.id;
  const { notifications, timezone } = req.body;

  try {
    await db.none(
      `UPDATE students
       SET notifications = $2, timezone = $3
       WHERE student_id = $1`,
      [userId, notifications === 'on', timezone]
    );

    res.json({ message: 'User settings saved successfully' });
  } catch (error) {
    console.error('Error saving user settings:', error);
    res.status(500).json({ error: 'Failed to save user settings' });
  }
});

// About Route (pass the user for a consistent nav bar)
app.get('/about', (req, res) => {
  res.render('pages/about', { title: 'About', user: req.session.user });
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
