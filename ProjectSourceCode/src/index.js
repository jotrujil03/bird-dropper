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
  host    : 'db',
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
  try {
    const u = await db.oneOrNone('SELECT * FROM students WHERE email=$1', [email]);
    if (!u || !(await bcrypt.compare(password, u.password)))
      return res.render('pages/login', { title: 'Login', error: 'Invalid email or password', formData: { email } });
    req.session.user = {
      id        : u.student_id,
      email     : u.email,
      username  : u.username,
      first_name: u.first_name,
      last_name : u.last_name,
      profileImage: u.profile_photo || '/images/cardinal-bird-branch.jpg'
    };
    res.redirect('/');
  } catch (err) {
    console.error(err);
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
    return req.accepts('json')
      ? res.status(500).json({ success: false, error: msg })
      : res.status(500).send(msg);
  }
});

// ---------- SOCIAL FEED ----------
app.get('/social', auth, async (req, res) => {
  const userId = req.session.user.id;
  const filter = req.query.filter === 'following' ? 'following' : 'all';

  try {
    let postsRaw;
    if (filter === 'following') {
      // only posts from people I follow
      postsRaw = await db.any(`
        SELECT p.*, s.username, s.profile_photo AS avatar, p.user_id,
               (SELECT COUNT(*) FROM likes WHERE post_id = p.post_id) AS like_count,
               (SELECT COALESCE(json_agg(json_build_object(
                 'comment_id', c.comment_id,
                 'comment'   , c.comment,
                 'username'  , s2.username,
                 'avatar'    , s2.profile_photo
               )), '[]'::json)
                FROM comments c
                JOIN students s2 ON c.user_id = s2.student_id
                WHERE c.post_id = p.post_id) AS comments
        FROM posts p
        JOIN follows f      ON f.following_id = p.user_id
        JOIN students s     ON p.user_id   = s.student_id
        WHERE f.follower_id = $1
        ORDER BY p.created_at DESC
      `, [userId]);
    } else {
      // all posts
      postsRaw = await db.any(`
        SELECT p.*, s.username, s.profile_photo AS avatar, p.user_id,
               (SELECT COUNT(*) FROM likes WHERE post_id = p.post_id) AS like_count,
               (SELECT COALESCE(json_agg(json_build_object(
                 'comment_id', c.comment_id,
                 'comment'   , c.comment,
                 'username'  , s2.username,
                 'avatar'    , s2.profile_photo
               )), '[]'::json)
                FROM comments c
                JOIN students s2 ON c.user_id = s2.student_id
                WHERE c.post_id = p.post_id) AS comments
        FROM posts p
        JOIN students s ON p.user_id = s.student_id
        ORDER BY p.created_at DESC
      `);
    }

    const posts = postsRaw.map(p => ({
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

    res.render('pages/social', {
      title:  'Social',
      user:   req.session.user,
      posts,
      filter
    });
  } catch (e) {
    console.error(e);
    res.render('pages/social', {
      title:  'Social',
      user:   req.session.user,
      posts:  [],
      filter,
      error:  'Could not load posts'
    });
  }
});

// ────────────────────────────────────────────────
//                 COLLECTIONS
// ────────────────────────────────────────────────
app.get('/collections', auth, (req, res) => {
  res.redirect(`/collections/${req.session.user.id}`);
});

app.get('/collections/:userId', auth, async (req, res) => {
  const profileUserId = parseInt(req.params.userId, 10);
  if (isNaN(profileUserId)) {
    return res.status(400).send('Invalid user ID');
  }
  const sessionUserId = req.session.user.id;
  const isOwner = sessionUserId === profileUserId;
  const sort = req.query.sort === 'liked' ? 'liked' : 'recent';

  try {
    const userViewed = await db.oneOrNone(`
      SELECT student_id AS id, username, profile_photo AS profileImage, bio
      FROM students
      WHERE student_id = $1
    `, [profileUserId]);
    if (!userViewed) {
      return res.status(404).render('pages/404');
    }

    let isFollowing = false;
    if (!isOwner) {
      const followRow = await db.oneOrNone(`
        SELECT 1
        FROM follows
        WHERE follower_id = $1 AND following_id = $2
      `, [sessionUserId, profileUserId]);
      isFollowing = !!followRow;
    }

    let photos = await db.any(`
      SELECT collection_id, image_url, description, created_at
      FROM collections
      WHERE user_id = $1
    `, [profileUserId]);

    const ids = photos.map(p => p.collection_id);
    if (ids.length) {
      const likesRows = await db.any(`
        SELECT collection_id, COUNT(*)::int AS like_count
        FROM collection_likes
        WHERE collection_id = ANY($1::int[])
        GROUP BY collection_id
      `, [ids]);
      const userLikeRows = await db.any(`
        SELECT collection_id
        FROM collection_likes
        WHERE user_id = $1 AND collection_id = ANY($2::int[])
      `, [sessionUserId, ids]);
      const likeCountMap = new Map(likesRows.map(r => [r.collection_id, r.like_count]));
      const likedSet = new Set(userLikeRows.map(r => r.collection_id));
      photos = photos.map(p => ({
        ...p,
        likeCount: likeCountMap.get(p.collection_id) || 0,
        isLiked: likedSet.has(p.collection_id)
      }));
    }

    if (sort === 'liked') {
      photos.sort((a, b) => b.likeCount - a.likeCount);
    } else {
      photos.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    res.render('pages/collections', {
      user: req.session.user,
      userViewed,
      isOwner,
      isFollowing,
      sort,
      photos
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading collection');
  }
});



app.post(
  '/collections/upload',
  auth,
  upload.array('collectionImages', 10),
  async (req, res) => {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: 'No files uploaded.' });
    }

    try {
      const added = [];
      for (const file of req.files) {
        const safeName = file.originalname
          .normalize('NFKD')
          .replace(/[^\w.\-]+/g, '-')
          .replace(/-+/g, '-');

        const pathInBucket = `collections/${req.session.user.id}/${Date.now()}-${safeName}`;

        const { error: upErr } = await supabase
          .storage
          .from(BUCKET)
          .upload(pathInBucket, file.buffer, {
            contentType: file.mimetype,
            upsert: false
          });
        if (upErr) {
          console.error('Supabase upload error:', upErr);
          return res.status(500).json({ success: false, error: 'Upload failed.' });
        }

        const { data: urlData, error: urlErr } = supabase
          .storage
          .from(BUCKET)
          .getPublicUrl(pathInBucket);
        if (urlErr) {
          console.error('Supabase getPublicUrl error:', urlErr);
          return res.status(500).json({ success: false, error: 'Could not get public URL.' });
        }

        const row = await db.one(
          `INSERT INTO collections (user_id, image_url, created_at)
           VALUES ($1, $2, NOW())
           RETURNING collection_id, image_url, description, created_at`,
          [req.session.user.id, urlData.publicUrl]
        );

        added.push(row);
      }

      return res.json({ success: true, photos: added });
    } catch (e) {
      console.error('Collection upload exception:', e);
      return res.status(500).json({ success: false, error: 'Failed to upload collection images.' });
    }
  }
);
app.post('/collections/delete/:id', auth, async (req, res) => {
  const colId        = parseInt(req.params.id, 10);
  const sessionUserId = req.session.user.id;

  try {
    const row = await db.oneOrNone(
      'SELECT image_url FROM collections WHERE collection_id = $1 AND user_id = $2',
      [colId, sessionUserId]
    );
    if (!row) {
      return res.status(403).send('Unauthorized to delete this item.');
    }
    const key = storageKeyFromUrl(row.image_url);
    if (key) {
      const { error: delErr } = await supabase.storage.from(BUCKET).remove([key]);
      if (delErr) console.warn('⚠️  Could not delete image from storage:', delErr.message);
    }
    await db.none('DELETE FROM collections WHERE collection_id = $1', [colId]);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting collection item:', err);
    res.status(500).json({ success: false, error: 'Failed to delete.' });
  }
});

app.post('/collections/description/:id', auth, async (req, res) => {
  const colId       = parseInt(req.params.id, 10);
  const { description } = req.body;

  try {
    const result = await db.result(
      'UPDATE collections SET description = $1 WHERE collection_id = $2 AND user_id = $3',
      [description, colId, req.session.user.id]
    );
    if (result.rowCount === 0) {
      return res
        .status(404)
        .json({ success: false, error: 'Collection not found or you are not the owner.' });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error('Description save error:', err);
    return res.status(500).json({ success: false, error: 'Could not save description.' });
  }
});
// ---------- LIKE / UNLIKE COLLECTION ITEM ----------
app.post('/like-collection/:id', auth, async (req, res) => {
  const colId  = parseInt(req.params.id, 10);
  const userId = req.session.user.id;
  try {
    const existing = await db.oneOrNone(
      `SELECT 1
         FROM collection_likes
        WHERE collection_id=$1
          AND user_id=$2`,
      [colId, userId]
    );

    if (existing) {
      await db.none(
        `DELETE FROM collection_likes
          WHERE collection_id=$1
            AND user_id=$2`,
        [colId, userId]
      );
    } else {
      await db.none(
        `INSERT INTO collection_likes(collection_id, user_id)
         VALUES($1, $2)`,
        [colId, userId]
      );
    }

    const { count } = await db.one(
      `SELECT COUNT(*)::int AS count
         FROM collection_likes
        WHERE collection_id = $1`,
      [colId]
    );

    res.json({ success: true, likeCount: count, isLiked: !existing });
  } catch (err) {
    console.error('Error toggling collection like:', err);
    res.status(500).json({ success: false });
  }
});

// ────────────────────────────────────────────────
//         FOLLOW ROUTES
// ────────────────────────────────────────────────
  app.get('/search-users', auth, async (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ users: [] });

    // find up to 5 matches, excluding yourself
    const users = await db.any(
      `SELECT student_id AS id, username
      FROM students
      WHERE username ILIKE $1
        AND student_id <> $2
      LIMIT 5`,
      [`%${q}%`, req.session.user.id]
    );

    const ids = users.map(u => u.id);
    const rows = await db.any(
      `SELECT following_id
      FROM follows
      WHERE follower_id = $1
        AND following_id = ANY($2::int[])`,
      [req.session.user.id, ids]
    );
    const followingIds = new Set(rows.map(r => r.following_id));

    res.json({
      users: users.map(u => ({
        id: u.id,
        username: u.username,
        isFollowing: followingIds.has(u.id)
      }))
    });
  });

  app.post('/follow/:id', auth, async (req, res) => {
    const target = parseInt(req.params.id, 10);
    if (target === req.session.user.id) {
      return res.status(400).json({ success: false, error: "Can't follow yourself." });
    }
    try {
      await db.none(
        `INSERT INTO follows (follower_id, following_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING`,
        [req.session.user.id, target]
      );
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: 'DB error.' });
    }
  });

  app.delete('/follow/:id', auth, async (req, res) => {
    const target = parseInt(req.params.id, 10);
    try {
      await db.none(
        `DELETE FROM follows
        WHERE follower_id = $1
          AND following_id = $2`,
        [req.session.user.id, target]
      );
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: 'DB error.' });
    }
  });
  app.get('/following', auth, async (req, res) => {
    const userId = req.session.user.id;
  
    try {
      // People you follow
      const followingRows = await db.any(`
        SELECT s.student_id AS id,
               s.username,
               s.profile_photo AS avatar,
               s.bio
        FROM follows f
        JOIN students s ON s.student_id = f.following_id
        WHERE f.follower_id = $1
        ORDER BY s.username
      `, [userId]);
  
      // People following you
      const followersRows = await db.any(`
        SELECT s.student_id AS id,
               s.username,
               s.profile_photo AS avatar,
               s.bio
        FROM follows f
        JOIN students s ON s.student_id = f.follower_id
        WHERE f.following_id = $1
        ORDER BY s.username
      `, [userId]);
  
      // Build a set of IDs you follow for “follow back” logic
      const followingIds = new Set(followingRows.map(u => u.id));
  
      // Format arrays for template
      const following = followingRows.map(u => ({
        id:       u.id,
        username: u.username,
        avatar:   u.avatar || '/images/default-avatar.png',
        bio:      u.bio || ''
      }));
      const followers = followersRows.map(u => ({
        id:             u.id,
        username:       u.username,
        avatar:         u.avatar || '/images/default-avatar.png',
        bio:            u.bio || '',
        isFollowedBack: followingIds.has(u.id)
      }));
  
      res.render('pages/following', {
        title:     'Following',
        user:      req.session.user,
        following,
        followers
      });
    } catch (e) {
      console.error('Error loading following page:', e);
      res.render('pages/following', {
        title:     'Following',
        user:      req.session.user,
        following: [],
        followers: [],
        error:     'Could not load follow data.'
      });
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
    // Get user data
    const user = await db.one('SELECT * FROM students WHERE student_id=$1', [req.session.user.id]);
    
    // Get user's posts with like counts
    const userPosts = await db.any(`
      SELECT p.*, 
        (SELECT COUNT(*) FROM likes WHERE post_id = p.post_id) AS like_count
      FROM posts p
      WHERE p.user_id = $1
      ORDER BY p.created_at DESC
    `, [req.session.user.id]);

    res.render('pages/profile', {
      title: 'Your Profile',
      user: user,
      profileImage: user.profile_photo || '/images/cardinal-bird-branch.jpg',
      bio: user.bio,
      userPosts: userPosts,  // Pass posts to template
      hasPosts: userPosts.length > 0  // Helper flag for template
    });
  } catch (e) {
    console.error('Profile error:', e);
    res.render('pages/profile', {
      title: 'Your Profile',
      user: req.session.user,
      error: 'Unable to load profile'
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


app.get('/fact-of-the-day', (req, res) => {
  const birdFacts = [
    "Hummingbirds can fly backwards.",
    "Owls can rotate their necks about 270 degrees.",
    "Peregrine Falcons dive at speeds over 240 mph.",
    "Penguins have knees, although they're hidden inside their bodies.",
    "The Ostrich is the largest bird in the world.",
    "Woodpeckers can peck 20 times per second.",
    "Flamingos get their color from the food they eat.",
    "Parrots can learn hundreds of words.",
    "Some ducks sleep with one eye open.",
    "Crows are known to recognize human faces.",
    "Albatrosses can fly thousands of miles without stopping.",
    "The chicken is the closest living relative to the Tyrannosaurus Rex.",
    "Some birds migrate tens of thousands of miles each year.",
    "The Kiwi bird lays eggs nearly as big as its own body.",
    "Bald Eagles build some of the largest nests in the world.",
    "Swifts can sleep while flying.",
    "The Emu is Australia's largest bird and second largest bird in the world.",
    "The Northern Cardinal can live up to 15 years in the wild.",
    "Geese mate for life and mourn the loss of their partners.",
    "The smallest bird egg belongs to the hummingbird."
  ];

  // Pick a fact based on today's date
  const date = new Date();
  const todayIndex = date.getDate() % birdFacts.length;
  const factOfTheDay = birdFacts[todayIndex];

  res.render('pages/factOfTheDay', { fact: factOfTheDay });
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
app.post('/update-username', auth, async (req, res) => {
  const { username } = req.body;
  if (!username || !username.trim()) {
    return res.status(400).json({ success:false, error:'Username is required.' });
  }
  const newUsername = username.trim();

  try {
    const exists = await db.oneOrNone(
      `SELECT 1 FROM students
       WHERE username = $1
         AND student_id <> $2`,
      [newUsername, req.session.user.id]
    );
    if (exists) {
      return res.status(400).json({ success:false, error:'That username is already taken.' });
    }

    await db.none(
      `UPDATE students
         SET username = $1
       WHERE student_id = $2`,
      [newUsername, req.session.user.id]
    );

    req.session.user.username = newUsername;

    res.json({ success:true, message:'Username updated successfully.' });
  } catch (err) {
    console.error('Error updating username:', err);
    res.status(500).json({ success:false, error:'Could not update username.' });
  }
});

// ---------- UPDATE PASSWORD ----------
app.post('/update-password', auth, async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;
  if (!currentPassword || !newPassword || !confirmPassword) {
    return res.status(400).json({ success:false, error:'All password fields are required.' });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ success:false, error:'New passwords do not match.' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ success:false, error:'New password must be at least 6 characters.' });
  }

  try {
    const { password: hash } = await db.one(
      `SELECT password FROM students WHERE student_id = $1`,
      [req.session.user.id]
    );

    const ok = await bcrypt.compare(currentPassword, hash);
    if (!ok) {
      return res.status(400).json({ success:false, error:'Current password is incorrect.' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await db.none(
      `UPDATE students
         SET password = $1
       WHERE student_id = $2`,
      [newHash, req.session.user.id]
    );

    res.json({ success:true, message:'Password changed successfully.' });
  } catch (err) {
    console.error('Error updating password:', err);
    res.status(500).json({ success:false, error:'Could not update password.' });
  }
});
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
