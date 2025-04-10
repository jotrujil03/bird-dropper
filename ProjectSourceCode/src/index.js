// Dependencies
const express = require('express');
const app = express();
const handlebars = require('express-handlebars');
const path = require('path');
const pgp = require('pg-promise')();
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcryptjs');

// App Configuration
const hbs = handlebars.create({
  extname: 'hbs',
  layoutsDir: path.join(__dirname, 'views/layouts'),
  partialsDir: path.join(__dirname, 'views/partials'),
  helpers: {
    ifEquals: function(arg1, arg2, options) {
      return (arg1 == arg2) ? options.fn(this) : options.inverse(this);
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

// Database Configuration
const dbConfig = {
  host: 'db',
  port: 5432,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
};
const db = pgp(dbConfig);

// Test DB Connection
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

          const newAdmin = await db.one(`
            INSERT INTO students (first_name, last_name, email, username, password)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING student_id
          `, ['Admin', 'User', adminEmail, adminUsername, hashedPassword]);

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

// Registration Routes (existing, unchanged)
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

    const newUser = await db.one(`
      INSERT INTO students 
      (first_name, last_name, email, username, password) 
      VALUES ($1, $2, $3, $4, $5) 
      RETURNING student_id, username, email, first_name, last_name
    `, [first_name, last_name, email, username, hashedPassword]);

    req.session.user = {
      id: newUser.student_id,
      username: newUser.username,
      email: newUser.email,
      first_name: newUser.first_name,
      last_name: newUser.last_name
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

// Middleware
const auth = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
};

// Share user data with all views
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

// Routes
app.get('/', async (req, res) => {
  try {
    const websiteSettings = await db.oneOrNone('SELECT theme, language FROM website_settings WHERE id = 1');
    const theme = websiteSettings ? websiteSettings.theme : 'light'; // Default if not found
    const language = websiteSettings ? websiteSettings.language : 'en'; // Default if not found

    res.render('pages/home', {
      title: 'Home',
      user: req.session.user,
      theme: theme,
      language: language,
      // ... other data you might be passing
    });
  } catch (error) {
    console.error('Error fetching website settings:', error);
    res.render('pages/home', {
      title: 'Home',
      user: req.session.user,
      theme: 'light', // Fallback default
      language: 'en',  // Fallback default
      // ... other data
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
    const user = await db.oneOrNone(`
      SELECT student_id, email, username, first_name, last_name, password 
      FROM students 
      WHERE email = $1
    `, [email]);
    
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
      last_name: user.last_name
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
app.get('/profile', auth, (req, res) => {
  // Retrieve the user from session
  const user = req.session.user;

  // Assign a default profile image if not available
  const profileImage = user.profileImage ? user.profileImage : '/images/cardinal-bird-branch.jpg';

  // Render the profile page with the title, user data, and profileImage
  res.render('pages/profile', {
    title: 'Your Profile',
    user,
    profileImage
  });
});

// Settings Route
app.get('/settings', (req, res) => {
  res.render('pages/settings', {
    title: 'Settings'
    //user: req.session.user
  })
});

// Search Route
app.get('/search', (req, res) => {
  res.render('pages/search', {
    title: 'Search'
  })
});

// Logout Route
app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) console.log('Session destruction error:', err);
    res.clearCookie('connect.sid');
    res.redirect('/');
  });
});

// API endpoint for saving website settings (anonymous access)
app.post('/settings/website', async (req, res) => {
  const { theme, language } = req.body;

  try {
    await db.none(`
      UPDATE website_settings
      SET theme = $1, language = $2
      WHERE id = 1 -- Assuming you only have one row for global settings
    `, [theme, language]);

    console.log('Website settings saved:', { theme, language });
    res.json({ message: 'Website settings saved successfully' });
  } catch (error) {
    console.error('Error saving website settings:', error);
    res.status(500).json({ error: 'Failed to save website settings' });
  }
});
app.post('/update-profile-image', async (req, res) => {
  try {
    // Assuming you store the user id in the session:
    const userId = req.session.userId;
    const { profileImage } = req.body;

    // Update the user's profile_photo field in the database.
    await pool.query('UPDATE students SET profile_photo = $1 WHERE student_id = $2', [profileImage, userId]);

    res.json({ success: true });
  } catch (err) {
    console.error('Error updating profile picture:', err);
    res.json({ success: false, error: 'Failed to update profile picture.' });
  }
});

// API endpoint for saving user-specific settings (requires login)
app.post('/settings/user', auth, async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Unauthorized' }); // Should be handled by auth middleware, but good to double-check
  }

  const userId = req.session.user.id;
  // Extract user-specific settings from the request body
  const { notifications, timezone } = req.body;

  try {
    // Logic to save user-specific settings to the database
    const updateUserSettings = await db.none(`
      UPDATE students
      SET notifications = $2, timezone = $3
      WHERE student_id = $1
    `, [userId, notifications === 'on', timezone]); // Assuming 'notifications' is a checkbox

    res.json({ message: 'User settings saved successfully' });
  } catch (error) {
    console.error('Error saving user settings:', error);
    res.status(500).json({ error: 'Failed to save user settings' });
  }
});

// Social Route
app.get('/social', (req, res) => {
  res.render('pages/social')
});

// About Route
app.get('/about', (req, res) => {
  res.render('pages/about')
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
