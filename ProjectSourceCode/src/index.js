// =============================
//  index.js  — Bird Dropper (MERGED)
// =============================
// 15‑Apr‑2025: combines socket.io, Wikipedia search, and
//              Supabase‑based image storage/cleanup
// ======================================================

// ──────────────────  DEPENDENCIES  ──────────────────
require('dotenv').config();
const express       = require('express');
const app           = express();
const http          = require('http');
const server        = http.createServer(app);
const socketIO      = require('socket.io');
const io            = socketIO(server);
const handlebars    = require('express-handlebars');
const path          = require('path');
const pgp           = require('pg-promise')();
const bodyParser    = require('body-parser');
const session       = require('express-session');
const bcrypt        = require('bcryptjs');
const multer        = require('multer');
const axios         = require('axios');
const { createClient } = require('@supabase/supabase-js');

// ──────────────────  SUPABASE  ──────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const BUCKET = process.env.SUPABASE_BUCKET;

// Helper: extract storage key from a public URL
function storageKeyFromUrl(url) {
  const u       = new URL(url);
  const prefix  = `/storage/v1/object/public/${BUCKET}/`;
  return u.pathname.startsWith(prefix) ? u.pathname.slice(prefix.length) : null;
}

// ──────────────────  BIRD‑FETCH (Wikipedia)  ──────────────────
async function fetchBirdInfoFromWikipedia(birdName) {
  const words = birdName.split(' ');
  if (words.length > 1) {
    for (let i = 1; i < words.length; i++) words[i] = words[i].toLowerCase();
    birdName = words.join(' ');
  }
  const underscored = birdName.replace(/ /g, '_');
  const apiUrl =
    `https://en.wikipedia.org/w/api.php?action=query&format=json` +
    `&prop=extracts|pageimages&titles=${encodeURIComponent(underscored)}` +
    `&explaintext&pithumbsize=500&exintro`;
  try {
    const { data } = await axios.get(apiUrl);
    const pages = data.query.pages;
    const pageId = Object.keys(pages)[0];
    if (pageId !== '-1') {
      const p = pages[pageId];
      return {
        name : birdName,
        info : p.extract || '',
        image: p.thumbnail ? p.thumbnail.source : null
      };
    }
    return { name: birdName, info: null, image: null };
  } catch (err) {
    console.error('Wikipedia error:', err);
    return { name: birdName, info: null, image: null };
  }
}

// ──────────────────  MULTER (memory)  ──────────────────
const upload = multer({ storage: multer.memoryStorage() });

// ──────────────────  HANDLEBARS  ──────────────────
const hbs = handlebars.create({
  extname    : 'hbs',
  layoutsDir : path.join(__dirname, 'views/layouts'),
  partialsDir: path.join(__dirname, 'views/partials'),
  helpers    : {
    ifEquals : (a, b, o) => (a == b ? o.fn(this) : o.inverse(this)),
    eq       : (a, b)   => a == b,
    formatDate: ts =>
      ts
        ? new Date(ts).toLocaleDateString('en-US', {
            year : 'numeric',
            month: 'short',
            day  : 'numeric',
            hour : '2-digit',
            minute: '2-digit'
          })
        : ''
  }
});
app.engine('hbs', hbs.engine);
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

// ──────────────────  MIDDLEWARE  ──────────────────
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'resources')));
app.use(session({
  secret           : process.env.SESSION_SECRET,
  saveUninitialized: false,
  resave           : false,
  cookie           : {
    secure : process.env.NODE_ENV === 'production',
    maxAge : 30 * 24 * 60 * 60 * 1000,
    httpOnly: true
  }
}));
app.use((req, res, next) => { res.locals.user = req.session.user || null; next(); });
const auth = (req, res, next) => { if (!req.session.user) return res.redirect('/login'); next(); };

// ──────────────────  DATABASE  ──────────────────
const db = pgp({
  host    : process.env.POSTGRES_HOST,
  port    : 5432,
  database: process.env.POSTGRES_DB,
  user    : process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD
});
db.connect().then(obj => {
  obj.done();
  console.log('📦  Connected to PostgreSQL');
  (async () => {
    const email = 'admin@admin.com';
    const exists = await db.oneOrNone('SELECT 1 FROM students WHERE email=$1', [email]);
    if (!exists) {
      const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
      await db.none(
        `INSERT INTO students(first_name,last_name,email,username,password,profile_photo)
         VALUES('Admin','User',$1,'admin',$2,'')`,
        [email, hash]
      );
      console.log('👑  Admin account created');
    }
  })();
}).catch(e => console.error('DB ERROR:', e.message || e));

// ────────────────────────────────────────────────
//                 AUTH / USER ROUTES
// ────────────────────────────────────────────────
app.get('/register', (req, res) => res.render('pages/register', { title: 'Register' }));

app.post('/register', async (req, res) => {
  const { first_name, last_name, email, username, password, confirm_password } = req.body;
  const formData = { first_name, last_name, email, username };
  if (password !== confirm_password)
    return res.render('pages/register', { title: 'Register', error: 'Passwords do not match', formData });
  try {
    const hash = await bcrypt.hash(password, 10);
    const u = await db.one(
      `INSERT INTO students(first_name,last_name,email,username,password,profile_photo)
       VALUES($1,$2,$3,$4,$5,'')
       RETURNING student_id,username,email,first_name,last_name,created_at`,
      [first_name, last_name, email, username, hash]
    );
    req.session.user = {
      id        : u.student_id,
      username  : u.username,
      email     : u.email,
      first_name: u.first_name,
      last_name : u.last_name,
      created_at: u.created_at,
      profileImage: '/images/cardinal-bird-branch.jpg'
    };
    res.redirect('/profile');
  } catch (err) {
    let error = 'Registration failed.';
    if (err.code === '23505') {
      if (err.constraint === 'students_email_key')    error = 'Email already in use';
      if (err.constraint === 'students_username_key') error = 'Username already taken';
    }
    res.render('pages/register', { title: 'Register', error, formData });
  }
});

app.get('/login',  (req, res) => res.render('pages/login', { title: 'Login' }));
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  console.log('Attempting login with email:', email); // Add this line
  try {
    const u = await db.oneOrNone('SELECT * FROM students WHERE email=$1', [email]);
    console.log('User found:', u); // Add this line
    if (!u || !(await bcrypt.compare(password, u.password))) {
      console.log('Login failed - invalid credentials'); // Add this line
      return res.render('pages/login', { title: 'Login', error: 'Invalid email or password', formData: { email } });
    }
    const passwordMatch = await bcrypt.compare(password, u.password);
    console.log('Password match:', passwordMatch); // Add this line
    req.session.user = {
      id        : u.student_id,
      email     : u.email,
      username  : u.username,
      first_name: u.first_name,
      last_name : u.last_name,
      profileImage: u.profile_photo || '/images/cardinal-bird-branch.jpg'
    };
    res.redirect('/profile');
  } catch (err) {
    console.error('Login error:', err); // Keep this error logging
    res.render('pages/login', { title: 'Login', error: 'Login failed.', formData: { email } });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) console.log(err);
    res.clearCookie('connect.sid');
    res.render('pages/logout', { title: 'Logging Out' });
  });
});

// ────────────────────────────────────────────────
//                 SOCIAL / FEED ROUTES
// ────────────────────────────────────────────────

// ---------- CREATE POST ----------
app.post('/post', auth, upload.single('photo'), async (req, res) => {
  const { caption, location } = req.body;
  const uid  = req.session.user.id;
  const file = req.file;
  if (!file) return res.status(400).send('No image uploaded.');

 /* replace unsafe chars with dashes and collapse repeats */
const safeName = file.originalname
.normalize('NFKD')                 // remove weird unicode
.replace(/[^\w.\-]+/g, '-')        // keep letters, numbers, _, -, .
.replace(/-+/g, '-');              // no double dashes

const fileName = `posts/${Date.now()}-${safeName}`;

  const { error: upErr } = await supabase
    .storage.from(BUCKET)
    .upload(fileName, file.buffer, { contentType: file.mimetype, upsert: false });
  if (upErr) {
    console.error(upErr);
    return res.status(500).send('Upload failed.');
  }
  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(fileName);

  await db.none(
    `INSERT INTO posts(user_id,image_url,caption,location,created_at)
     VALUES($1,$2,$3,$4,NOW())`,
    [uid, urlData.publicUrl, caption, location || null]
  );
  res.redirect('/social');
});

// ---------- DELETE POST ----------
app.post('/delete-post/:id', auth, async (req, res) => {
  const id  = req.params.id;
  const uid = req.session.user.id;
  try {
    const p = await db.oneOrNone(
      'SELECT image_url FROM posts WHERE post_id=$1 AND user_id=$2',
      [id, uid]
    );
    if (!p) return res.status(403).send('Unauthorized to delete this post.');

    const key = storageKeyFromUrl(p.image_url);
    if (key) {
      const { error: delErr } = await supabase.storage.from(BUCKET).remove([key]);
      if (delErr) console.warn('⚠️  Could not delete image:', delErr.message);
    }
    await db.none('DELETE FROM posts WHERE post_id=$1', [id]);
    res.redirect('/social');
  } catch (e) {
    console.error(e);
    res.status(500).send('Failed to delete post.');
  }
});

// ---------- LIKE / UNLIKE ----------
app.post('/like-post/:id', auth, async (req, res) => {
  const pid = req.params.id, uid = req.session.user.id;
  try {
    const l = await db.oneOrNone(
      'SELECT like_id FROM likes WHERE post_id=$1 AND user_id=$2',
      [pid, uid]
    );
    if (l) await db.none('DELETE FROM likes WHERE like_id=$1', [l.like_id]);
    else   await db.none('INSERT INTO likes(post_id,user_id) VALUES($1,$2)', [pid, uid]);
    const { count } = await db.one('SELECT COUNT(*) FROM likes WHERE post_id=$1', [pid]);
    io.emit('notificationUpdate');
    res.json({ success: true, likeCount: count });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false });
  }
});

// ---------- ADD COMMENT ----------
app.post('/comment-post/:id', auth, async (req, res) => {
  const pid = req.params.id, uid = req.session.user.id, { comment } = req.body;
  if (!comment || !comment.trim())
    return res.status(400).json({ success: false, error: 'Empty' });
  try {
    const { comment_id } = await db.one(
      'INSERT INTO comments(post_id,user_id,comment) VALUES($1,$2,$3) RETURNING comment_id',
      [pid, uid, comment]
    );
    const { count } = await db.one('SELECT COUNT(*) FROM comments WHERE post_id=$1', [pid]);
    io.emit('notificationUpdate');
    res.json({ success: true, commentId: comment_id, commentCount: count });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false });
  }
});

// ---------- DELETE COMMENT ----------
app.post('/delete-comment/:id', auth, async (req, res) => {
  const cid = req.params.id, uid = req.session.user.id;
  try {
    const c = await db.oneOrNone(
      'SELECT comment_id FROM comments WHERE comment_id=$1 AND user_id=$2',
      [cid, uid]
    );
    if (!c) {
      const msg = 'Unauthorized';
      return req.accepts('json')
        ? res.status(403).json({ success: false, error: msg })
        : res.status(403).send(msg);
    }
    await db.none('DELETE FROM comments WHERE comment_id=$1', [cid]);
    return req.accepts('json')
      ? res.json({ success: true })
      : res.redirect('/social');
  } catch (e) {
    console.error(e);
    const msg = 'Failed';
    req.accepts('json')
      ? res.status(500).json({ success: false, error: msg })
      : res.status(500).send(msg);
  }
});

// ---------- SOCIAL FEED ----------
app.get('/social', auth, async (req, res) => {
  try {
    const posts = await db.any(`
      SELECT p.*, s.username, s.profile_photo AS avatar, p.user_id,
             (SELECT COUNT(*) FROM likes WHERE post_id=p.post_id) AS like_count,
             (SELECT COALESCE(json_agg(json_build_object(
                 'comment_id',c.comment_id,
                 'comment'   ,c.comment,
                 'username'  ,s2.username,
                 'avatar'    ,s2.profile_photo
             )),'[]'::json)
              FROM comments c
              JOIN students s2 ON c.user_id=s2.student_id
              WHERE c.post_id=p.post_id) AS comments
      FROM posts p
      JOIN students s ON p.user_id=s.student_id
      ORDER BY p.created_at DESC
    `);
    const formatted = posts.map(p => ({
      id        : p.post_id,
      imageUrl  : p.image_url,
      caption   : p.caption,
      location  : p.location,
      createdAt : p.created_at,
      likes     : p.like_count,
      comments  : p.comments,
      user      : {
        id      : p.user_id,
        username: p.username,
        avatar  : p.avatar || '/images/cardinal-bird-branch.jpg'
      }
    }));
    res.render('pages/social', { title: 'Social', user: req.session.user, posts: formatted });
  } catch (e) {
    console.error(e);
    res.render('pages/social', { title: 'Social', posts: [], error: 'Could not load posts' });
  }
});

// ────────────────────────────────────────────────
//          NOTIFICATIONS API  (likes/comments)
// ────────────────────────────────────────────────
app.get('/api/notifications', auth, async (req, res) => {
  const userId = req.session.user.id;
  try {
    const likes = await db.any(`
      SELECT l.post_id, s.username AS from_user, p.caption AS post_caption
      FROM likes l
      JOIN posts p ON l.post_id = p.post_id
      JOIN students s ON l.user_id = s.student_id
      WHERE p.user_id = $1
      ORDER BY l.created_at DESC
      LIMIT 5;
    `, [userId]);
    const comments = await db.any(`
      SELECT c.post_id, s.username AS from_user, p.caption AS post_caption, c.comment AS comment_text
      FROM comments c
      JOIN posts p ON c.post_id = p.post_id
      JOIN students s ON c.user_id = s.student_id
      WHERE p.user_id = $1
      ORDER BY c.created_at DESC
      LIMIT 5;
    `, [userId]);
    const notifications = [];
    likes.forEach(l => notifications.push({
      message: `${l.from_user} liked your post "${l.post_caption}"`,
      postId : l.post_id
    }));
    comments.forEach(c => notifications.push({
      message: `${c.from_user} commented on your post "${c.post_caption}": "${c.comment_text}"`,
      postId : c.post_id
    }));
    res.json({ notifications });
  } catch (err) {
    console.error('Notification fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// ────────────────────────────────────────────────
//         HOME / PROFILE / SETTINGS / SEARCH
// ────────────────────────────────────────────────
app.get('/', async (req, res) => {
  try {
    const ws = await db.oneOrNone('SELECT theme,language FROM website_settings WHERE id=1');
    res.render('pages/home', {
      title   : 'Home',
      user    : req.session.user,
      theme   : ws ? ws.theme : 'light',
      language: ws ? ws.language : 'en'
    });
  } catch (e) {
    console.error(e);
    res.render('pages/home', { title: 'Home', user: req.session.user, theme: 'light', language: 'en' });
  }
});

app.get('/profile', auth, async (req, res) => {
  try {
    const s = await db.one('SELECT * FROM students WHERE student_id=$1', [req.session.user.id]);
    req.session.user.bio = s.bio;
    res.render('pages/profile', {
      title       : 'Your Profile',
      user        : s,
      profileImage: s.profile_photo || '/images/cardinal-bird-branch.jpg',
      bio         : s.bio
    });
  } catch (e) {
    console.error(e);
    res.render('pages/profile', {
      title       : 'Your Profile',
      user        : req.session.user,
      profileImage: req.session.user.profileImage || '/images/cardinal-bird-branch.jpg',
      error       : 'Unable to load profile'
    });
  }
});

app.post('/edit-profile', auth, async (req, res) => {
  const { bio } = req.body;
  try {
    await db.none('UPDATE students SET bio=$1 WHERE student_id=$2', [bio, req.session.user.id]);
    req.session.user.bio = bio;
    res.redirect('/profile');
  } catch (e) {
    console.error(e);
    res.render('pages/profile', { title: 'Your Profile', user: req.session.user, error: 'Failed to update profile' });
  }
});

// ---------- BROWSE POPULAR BIRD SPECIES ----------
app.get('/browse', async (req, res) => {
  try {
    // Define an array with a bunch of popular bird names.
    const popularBirds = [
      'Northern Cardinal',
      'Blue Jay',
      'American Robin',
      'Bald Eagle',
      'Great Horned Owl',
      'Peregrine Falcon',
      'Duck',
      'Red-tailed Hawk',
      'Starling',
      'House Sparrow'
    ];

    // Loop over each bird and fetch the info from Wikipedia.
    const species = [];
    for (const birdName of popularBirds) {
      const info = await fetchBirdInfoFromWikipedia(birdName);
      // Convert the returned image field into a consistent images array.
      species.push({
        name  : info.name,
        info  : info.info,
        image : info.image,
        images: info.image ? [info.image] : []
      });
    }

    // Render the browse page, passing in the species array.
    res.render('pages/browse', {
      title   : 'Browse Popular Bird Species',
      species : species,
      language: 'en',
      user    : req.session.user
    });
  } catch (err) {
    console.error('Browse error:', err);
    res.render('pages/browse', { error: 'Unable to fetch popular birds' });
  }
});





app.get('/settings', (req, res) => res.render('pages/settings', { title: 'Settings' }));

app.get('/search', async (req, res) => {
  const { query } = req.query;
  if (!query || !query.trim())
    return res.render('pages/search', { title: 'Search', results: [], query: query || '' });
  try {
    const wikiData = await fetchBirdInfoFromWikipedia(query);
    res.render('pages/search', { title: 'Search', results: [wikiData], query });
  } catch (err) {
    console.error('Search error:', err);
    res.render('pages/search', { title: 'Search', error: 'Failed to search Wikipedia.', results: [], query });
  }
});

app.get('/about', (req, res) => res.render('pages/about', { title: 'About', user: req.session.user }));

// ---------- SAVE WEBSITE SETTINGS ----------
app.post('/settings/website', async (req, res) => {
  const { theme, language } = req.body;
  try {
    await db.none('UPDATE website_settings SET theme=$1,language=$2 WHERE id=1', [theme, language]);
    res.json({ message: 'Saved' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- SAVE USER SETTINGS ----------
app.post('/settings/user', auth, async (req, res) => {
  const { notifications, timezone } = req.body;
  try {
    await db.none(
      'UPDATE students SET notifications=$2,timezone=$3 WHERE student_id=$1',
      [req.session.user.id, notifications === 'on', timezone]
    );
    res.json({ message: 'Saved' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed' });
  }
});

// ---------- UPDATE PROFILE PICTURE ----------
app.post('/update-profile-image', auth, upload.single('profileImage'), async (req, res) => {
  if (!req.file)
    return res.status(400).json({ success: false, error: 'No file uploaded.' });
  try {
    const { profile_photo } = await db.one(
      'SELECT profile_photo FROM students WHERE student_id=$1',
      [req.session.user.id]
    );
    const fileName = `profile/${Date.now()}-${req.file.originalname}`;
    const { error: upErr } = await supabase
      .storage.from(BUCKET)
      .upload(fileName, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
    if (upErr) {
      console.error(upErr);
      return res.status(500).json({ success: false, error: 'Upload failed.' });
    }
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(fileName);
    const newUrl = urlData.publicUrl;

    if (profile_photo && profile_photo.includes(process.env.SUPABASE_URL)) {
      const key = storageKeyFromUrl(profile_photo);
      if (key) await supabase.storage.from(BUCKET).remove([key]);
    }

    await db.none('UPDATE students SET profile_photo=$1 WHERE student_id=$2',
                  [newUrl, req.session.user.id]);
    req.session.user.profileImage = newUrl;
    res.json({ success: true, profileImage: newUrl });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: 'Failed to update profile picture.' });
  }
});

// ────────────────────────────────────────────────
//                     SERVER
// ────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀  Server running on port ${PORT}`));
module.exports = server; // for testing purposes
