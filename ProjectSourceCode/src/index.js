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

// ✅ Serve static files from the 'resources' folder (for favicon, CSS, images, etc.)
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

// -------------------------------------  USER OBJECT   ------------------------------------------------
const user = {
  student_id: undefined,
  username: undefined,
  first_name: undefined,
  last_name: undefined,
  email: undefined,
};

// -------------------------------------  PUBLIC ROUTES (Login & Register)  ----------------------------

app.get('/login', (req, res) => {
  res.render('pages/login');
});

app.post('/login', (req, res) => {
  const { email, username } = req.body;
  const query = 'SELECT * FROM students WHERE email = $1 LIMIT 1';
  const values = [email];

  db.one(query, values)
    .then(data => {
      user.username = username;
      user.first_name = data.first_name;
      user.last_name = data.last_name;
      user.email = data.email;

      req.session.user = user;
      req.session.save();
      res.redirect('/');
    })
    .catch(err => {
      console.log(err);
      res.render('pages/login', { error: 'Login failed. Please check your credentials.' });
    });
});

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
    confirm_password
  } = req.body;

  if (password !== confirm_password) {
    return res.render('pages/register', { error: "Passwords do not match" });
  }

  const insertQuery = `
    INSERT INTO students (first_name, last_name, email, username, password)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *;
  `;

  db.one(insertQuery, [first_name, last_name, email, username, password])
    .then(newUser => {
      req.session.user = newUser;
      res.redirect('/');
    })
    .catch(err => {
      console.error(err);
      res.render('pages/register', { error: "Registration failed. Email may already be in use." });
    });
});

app.get('/profile', (req, res) => {
  const userData = {
    username: 'john_doe',
    email: 'john@example.com',
    bio: 'Bird enthusiast!',
    profileImage: '/images/profile.jpg',
    memberSince: 'January 2023'
  };

  res.render('profile', userData);
});

// -------------------------------------  AUTH MIDDLEWARE  ------------------------
// Uncomment this line when you're ready to enforce login
// app.use(auth);

const auth = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
};

// -------------------------------------  HOME ROUTE (PUBLIC FOR NOW)  ----------------------------
app.get('/', (req, res) => {
  const user = req.session.user || {};

  res.render('pages/home', {
    username: user.username || 'Guest',
    first_name: user.first_name || '',
    last_name: user.last_name || '',
    email: user.email || ''
  });
});

// -------------------------------------  LOGOUT ROUTE  ------------------------------------------------
app.get('/login', (req, res) => {
  req.session.destroy(function(err) {
    res.redirect('/login');
  });
});


// -------------------------------------  START SERVER  ------------------------------------------------
app.listen(3000, () => {
  console.log('Server is listening on port 3000');
});
