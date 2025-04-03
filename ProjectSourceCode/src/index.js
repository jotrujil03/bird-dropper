// ----------------------------------   DEPENDENCIES  ----------------------------------------------
const express = require('express');
const app = express();
const handlebars = require('express-handlebars');
const path = require('path');
const pgp = require('pg-promise')();
const bodyParser = require('body-parser');
const session = require('express-session');

// -------------------------------------  APP CONFIG   ----------------------------------------------
const hbs = handlebars.create({
  extname: 'hbs',
  layoutsDir: __dirname + '/views/layouts',
  partialsDir: __dirname + '/views/partials',
});

app.engine('hbs', hbs.engine);
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static files from the 'resources' folder (for favicon, CSS, images, etc.)
app.use(express.static(path.join(__dirname, 'resources')));

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    saveUninitialized: true,
    resave: true,
  })
);

app.use((req, res, next) => {
  res.locals.user = req.session.user;
  next();
});

// -------------------------------------  DB CONFIG AND CONNECT   ---------------------------------------
const dbConfig = {
  host: 'db',
  port: 5432,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
};
const db = pgp(dbConfig);

db.connect()
  .then(obj => {
    console.log('Database connection successful');
    obj.done();
  })
  .catch(error => {
    console.log('ERROR', error.message || error);
  });

// -------------------------------------  PUBLIC ROUTES (Login & Register)  ----------------------------

// GET route for login page using the provided login.hbs
app.get('/login', (req, res) => {
  res.render('pages/login', { error: null });
});

// POST route for login that checks credentials from the "users" table
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const query = 'SELECT * FROM users WHERE username = $1 AND password = $2 LIMIT 1';
  const values = [username, password];

  db.oneOrNone(query, values)
    .then(data => {
      if (data) {
        req.session.user = { username: data.username };
        req.session.successMessage = "Successfully logged in!";
        req.session.save(() => {
          res.redirect('/');
        });
      } else {
        res.render('pages/login', { error: 'Invalid username or password.' });
      }
    })
    .catch(err => {
      console.error('Login query error:', err);
      res.render('pages/login', { error: 'An error occurred during login. Please try again.' });
    });
});

app.get('/', (req, res) => {
  const successMessage = req.session.successMessage;
  delete req.session.successMessage;
  res.render('pages/home', { 
    user: req.session.user || {}, 
    successMessage 
  });
});

// Registration routes remain as is (using the students table)
app.get('/register', (req, res) => {
  res.render('pages/register');
});

app.post('/register', (req, res) => {
  const {
    first_name,
    last_name,
    email,
    username,
    password,
    confirm_password,
    year,
    major,
    degree
  } = req.body;

  if (password !== confirm_password) {
    return res.render('pages/register', { error: "Passwords do not match" });
  }

  const insertQuery = `
    INSERT INTO students (first_name, last_name, email, username, password, year, major, degree)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *;
  `;

  db.one(insertQuery, [first_name, last_name, email, username, password, year, major, degree])
    .then(newUser => {
      req.session.user = newUser;
      res.redirect('/');
    })
    .catch(err => {
      console.error(err);
      res.render('pages/register', { error: "Registration failed. Email may already be in use." });
    });
});

// GET route for profile page that redirects if not logged in
app.get('/profile', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  const userData = {
    username: req.session.user.username,
    email: req.session.user.email || 'admin@example.com',
    bio: req.session.user.bio || 'Default bio here',
    memberSince: req.session.user.memberSince || 'Unknown',
    profileImage: req.session.user.profileImage || '/images/default-profile.png'
  };

  res.render('pages/profile', userData);
});

app.get('/settings', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  res.render('pages/settings', { user: req.session.user });
});

// -------------------------------------  AUTH MIDDLEWARE  ------------------------
const auth = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
};

// -------------------------------------  HOME ROUTE (PUBLIC FOR NOW)  ----------------------------
app.get('/', (req, res) => {
  if (req.session.user) {
    return res.redirect('/profile');
  }
  const sessionUser = req.session.user || {};
  res.render('pages/home', {
    username: sessionUser.username || 'Guest',
    first_name: sessionUser.first_name || '',
    last_name: sessionUser.last_name || '',
    email: sessionUser.email || '',
    year: sessionUser.year || '',
    major: sessionUser.major || '',
    degree: sessionUser.degree || '',
  });
});

// -------------------------------------  LOGOUT ROUTE  ------------------------------------------------
app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Error destroying session:', err);
    }
    res.redirect('/login');
  });
});

// -------------------------------------  START SERVER  ------------------------------------------------
app.listen(3000, () => {
  console.log('Server is listening on port 3000');
});
