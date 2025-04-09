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
app.get('/', (req, res) => {
  res.render('pages/home', {
    title: 'Home',
    user: req.session.user
  });
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
      (first_name, last_name, email, username, password_hash) 
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

// Profile Route
app.get('/profile', auth, (req, res) => {
  res.render('pages/profile', {
    title: 'Your Profile',
    user: req.session.user
  });
});

// Logout Route
app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) console.log('Session destruction error:', err);
    res.clearCookie('connect.sid');
    res.redirect('/');
  });
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
