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

// ✅ Serve static files from the 'resources' folder
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
  year: undefined,
  major: undefined,
  degree: undefined,
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
      user.student_id = data.student_id;
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

// -------------------------------------  AUTH MIDDLEWARE (after public routes)  ------------------------
const auth = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
};

app.use(auth);

// -------------------------------------  PROTECTED ROUTES  --------------------------------------------
app.get('/', (req, res) => {
  res.render('pages/home', {
    username: req.session.user.username,
    first_name: req.session.user.first_name,
    last_name: req.session.user.last_name,
    email: req.session.user.email,
    year: req.session.user.year,
    major: req.session.user.major,
    degree: req.session.user.degree,
  });
});

const student_courses = `
  SELECT DISTINCT
    courses.course_id,
    courses.course_name,
    courses.credit_hours,
    students.student_id = $1 AS "taken"
  FROM
    courses
    JOIN student_courses ON courses.course_id = student_courses.course_id
    JOIN students ON student_courses.student_id = students.student_id
  WHERE students.student_id = $1
  ORDER BY courses.course_id ASC;
`;

const all_courses = `
  SELECT
    courses.course_id,
    courses.course_name,
    courses.credit_hours,
    CASE
    WHEN
    courses.course_id IN (
      SELECT student_courses.course_id
      FROM student_courses
      WHERE student_courses.student_id = $1
    ) THEN TRUE
    ELSE FALSE
    END
    AS "taken"
  FROM
    courses
  ORDER BY courses.course_id ASC;
`;

app.get('/courses', (req, res) => {
  const taken = req.query.taken;

  db.any(taken ? student_courses : all_courses, [req.session.user.student_id])
    .then(courses => {
      res.render('pages/courses', {
        email: user.email,
        courses,
        action: req.query.taken ? 'delete' : 'add',
      });
    })
    .catch(err => {
      res.render('pages/courses', {
        courses: [],
        email: user.email,
        error: true,
        message: err.message,
      });
    });
});

app.post('/courses/add', (req, res) => {
  const course_id = parseInt(req.body.course_id);

  db.tx(async t => {
    const { num_prerequisites } = await t.one(
      `SELECT num_prerequisites FROM course_prerequisite_count WHERE course_id = $1`,
      [course_id]
    );

    if (num_prerequisites > 0) {
      const [row] = await t.any(
        `SELECT num_prerequisites_satisfied FROM student_prerequisite_count
         WHERE course_id = $1 AND student_id = $2`,
        [course_id, req.session.user.student_id]
      );

      if (!row || row.num_prerequisites_satisfied < num_prerequisites) {
        throw new Error(`Prerequisites not satisfied for course ${course_id}`);
      }
    }

    await t.none(
      'INSERT INTO student_courses(course_id, student_id) VALUES ($1, $2);',
      [course_id, req.session.user.student_id]
    );

    return t.any(all_courses, [req.session.user.student_id]);
  })
    .then(courses => {
      res.render('pages/courses', {
        email: user.email,
        courses,
        message: `Successfully added course ${req.body.course_id}`,
      });
    })
    .catch(err => {
      res.render('pages/courses', {
        email: user.email,
        courses: [],
        error: true,
        message: err.message,
      });
    });
});

// -------------------------------------  LOGOUT ROUTE  ------------------------------------------------
app.get('/logout', (req, res) => {
  req.session.destroy(function(err) {
    res.render('pages/logout');
  });
});

// -------------------------------------  START SERVER  ------------------------------------------------
app.listen(3000, () => {
  console.log('Server is listening on port 3000');
});
