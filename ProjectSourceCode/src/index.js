// =============================
//  index.js  — Bird Dropper (FULL)
// =============================
// 14‑Apr‑2025: merged like/comment AJAX routes **and** added automatic
//              image‑file cleanup when a post is deleted.


// ──────────────────  DEPENDENCIES  ──────────────────
const express    = require('express');
const app        = express();
const handlebars = require('express-handlebars');
const path       = require('path');
const fs         = require('fs');                 // remove orphaned images
const pgp        = require('pg-promise')();
const bodyParser = require('body-parser');
const session    = require('express-session');
const bcrypt     = require('bcryptjs');
const multer     = require('multer');
const sharp      = require('sharp');              // NEW: for image processing

// ──────────────────  MULTER CONFIG  ──────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'resources/uploads')),
  filename   : (req, file, cb) =>
    cb(null, `${file.fieldname}-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`)
});
const upload = multer({ storage });

// ──────────────────  HANDLEBARS  ──────────────────
const hbs = handlebars.create({
  extname: 'hbs',
  layoutsDir: path.join(__dirname, 'views/layouts'),
  partialsDir: path.join(__dirname, 'views/partials'),
  helpers: {
    ifEquals: (a, b, o) => a == b ? o.fn(this) : o.inverse(this),
    eq: (a, b) => a == b,
    formatDate: ts => ts
      ? new Date(ts).toLocaleDateString('en-US', {
          year: 'numeric', month: 'short', day: 'numeric',
          hour: '2-digit', minute: '2-digit'
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
  secret: process.env.SESSION_SECRET,
  saveUninitialized: false,
  resave: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true
  }
}));
app.use((req, res, next) => { res.locals.user = req.session.user || null; next(); });
const auth = (req, res, next) => { if (!req.session.user) return res.redirect('/login'); next(); };

// ──────────────────  DATABASE  ──────────────────
const db = pgp({
  host: 'db',
  port: 5432,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD
});

db.connect().then(obj => {
  obj.done();
  console.log('📦  Connected to PostgreSQL');

  // ensure admin exists
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
//               SOCIAL / FEED ROUTES
// ────────────────────────────────────────────────

// Create post (with image resizing if necessary)
app.post('/post', auth, upload.single('photo'), async (req, res) => {
  const { caption } = req.body;
  const uid = req.session.user.id;
  if (!req.file) return res.status(400).send('No image uploaded.');

  const imagePath = req.file.path;
  
  try {
    // Read the uploaded file into a buffer
    const imageBuffer = await fs.promises.readFile(imagePath);
    // Retrieve metadata from the buffer using Sharp
    const metadata = await sharp(imageBuffer).metadata();
    console.log(`Original dimensions: ${metadata.width} x ${metadata.height}`);
    
    // Check whether the image is larger than 1920x1080
    if (metadata.width > 1920 || metadata.height > 1080) {
      const resizedBuffer = await sharp(imageBuffer)
        .resize({ width: 1920, height: 1080, fit: 'inside', withoutEnlargement: true })
        .toBuffer();
      // Overwrite the original file with the resized image
      await fs.promises.writeFile(imagePath, resizedBuffer);
      
      // Log new dimensions from the resized buffer for verification
      const newMetadata = await sharp(resizedBuffer).metadata();
      console.log(`Resized dimensions: ${newMetadata.width} x ${newMetadata.height}`);
    } else {
      console.log('Image is within 1080p bounds; no resizing needed.');
    }
  } catch (error) {
    console.error('Error during image processing:', error);
    // Optionally, decide whether to proceed with the original image or abort the request
  }
  
  try {
    await db.none(
      'INSERT INTO posts(user_id,image_url,caption,created_at) VALUES($1,$2,$3,NOW())',
      [uid, `/uploads/${req.file.filename}`, caption]
    );
    res.redirect('/social');
  } catch (e) {
    console.error(e);
    res.status(500).send('Error saving post.');
  }
});


// Delete post (also deletes image file)
app.post('/delete-post/:id',auth,async(req,res)=>{
  const id=req.params.id, uid=req.session.user.id;
  try{
    const p=await db.oneOrNone(
      'SELECT image_url FROM posts WHERE post_id=$1 AND user_id=$2',
      [id,uid]
    );
    if(!p) return res.status(403).send('Unauthorized to delete this post.');

    await db.none('DELETE FROM posts WHERE post_id=$1',[id]);

    if(p.image_url){
      const fp=path.join(__dirname,'resources',p.image_url.replace(/^\//,''));
      fs.unlink(fp,err=>{
        if(err) console.warn('⚠️  Could not remove',fp);
      });
    }
    res.redirect('/social');
  }catch(e){
    console.error(e);
    res.status(500).send('Failed to delete post.');
  }
});

// Like / Unlike
app.post('/like-post/:id',auth,async(req,res)=>{
  const pid=req.params.id, uid=req.session.user.id;
  try{
    const l=await db.oneOrNone(
      'SELECT like_id FROM likes WHERE post_id=$1 AND user_id=$2',
      [pid,uid]
    );
    if(l) await db.none('DELETE FROM likes WHERE like_id=$1',[l.like_id]);
    else   await db.none('INSERT INTO likes(post_id,user_id) VALUES($1,$2)',[pid,uid]);

    const {count}=await db.one('SELECT COUNT(*) FROM likes WHERE post_id=$1',[pid]);
    res.json({success:true,likeCount:count});
  }catch(e){
    console.error(e);
    res.status(500).json({success:false});
  }
});

// Add comment (returns id & count)
app.post('/comment-post/:id',auth,async(req,res)=>{
  const pid=req.params.id, uid=req.session.user.id, {comment}=req.body;
  if(!comment || !comment.trim())
    return res.status(400).json({success:false,error:'Empty'});

  try{
    const {comment_id}=await db.one(
      'INSERT INTO comments(post_id,user_id,comment) VALUES($1,$2,$3) RETURNING comment_id',
      [pid,uid,comment]
    );
    const {count}=await db.one('SELECT COUNT(*) FROM comments WHERE post_id=$1',[pid]);
    res.json({success:true,commentId:comment_id,commentCount:count});
  }catch(e){
    console.error(e);
    res.status(500).json({success:false});
  }
});

// Delete comment
app.post('/delete-comment/:id',auth,async(req,res)=>{
  const cid=req.params.id, uid=req.session.user.id;
  try{
    const c=await db.oneOrNone(
      'SELECT comment_id FROM comments WHERE comment_id=$1 AND user_id=$2',
      [cid,uid]
    );
    if(!c){
      const msg='Unauthorized';
      return req.accepts('json')
        ? res.status(403).json({success:false,error:msg})
        : res.status(403).send(msg);
    }
    await db.none('DELETE FROM comments WHERE comment_id=$1',[cid]);
    return req.accepts('json')
      ? res.json({success:true})
      : res.redirect('/social');
  }catch(e){
    console.error(e);
    const msg='Failed';
    req.accepts('json')
      ? res.status(500).json({success:false,error:msg})
      : res.status(500).send(msg);
  }
});

// Social feed
app.get('/social',auth,async(req,res)=>{
  try{
    const posts=await db.any(`
      SELECT p.*,s.username,s.profile_photo AS avatar,p.user_id,
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
        ORDER BY p.created_at DESC`);
    const formatted=posts.map(p=>({
      id:p.post_id,imageUrl:p.image_url,caption:p.caption,createdAt:p.created_at,
      likes:p.like_count,comments:p.comments,
      user:{id:p.user_id,username:p.username,
            avatar:p.avatar||'/images/cardinal-bird-branch.jpg'}
    }));
    res.render('pages/social',{title:'Social',user:req.session.user,posts:formatted});
  }catch(e){
    console.error(e);
    res.render('pages/social',{title:'Social',posts:[],error:'Could not load posts'});
  }
});

// ────────────────────────────────────────────────
//            HOME / PROFILE / SETTINGS
// ────────────────────────────────────────────────
app.get('/',async(req,res)=>{
  try{
    const ws=await db.oneOrNone('SELECT theme,language FROM website_settings WHERE id=1');
    res.render('pages/home',{
      title:'Home',
      user:req.session.user,
      theme:ws?ws.theme:'light',
      language:ws?ws.language:'en'
    });
  }catch(e){
    console.error(e);
    res.render('pages/home',{title:'Home',user:req.session.user,theme:'light',language:'en'});
  }
});

app.get('/profile',auth,async(req,res)=>{
  try{
    const s=await db.one('SELECT * FROM students WHERE student_id=$1',[req.session.user.id]);
    req.session.user.bio=s.bio;
    res.render('pages/profile',{
      title:'Your Profile',
      user:s,
      profileImage:s.profile_photo||'/images/cardinal-bird-branch.jpg',
      bio:s.bio
    });
  }catch(e){
    console.error(e);
    res.render('pages/profile',{
      title:'Your Profile',
      user:req.session.user,
      profileImage:req.session.user.profileImage||'/images/cardinal-bird-branch.jpg',
      error:'Unable to load profile'
    });
  }
});

app.post('/edit-profile',auth,async(req,res)=>{
  const {bio}=req.body;
  try{
    await db.none('UPDATE students SET bio=$1 WHERE student_id=$2',[bio,req.session.user.id]);
    req.session.user.bio=bio;
    res.redirect('/profile');
  }catch(e){
    console.error(e);
    res.render('pages/profile',{title:'Your Profile',user:req.session.user,error:'Failed to update profile'});
  }
});

app.get('/settings',(req,res)=>res.render('pages/settings',{title:'Settings'}));
app.get('/search',(req,res)=>res.render('pages/search',{title:'Search'}));
app.get('/about',(req,res)=>res.render('pages/about',{title:'About',user:req.session.user}));

// Save website settings
app.post('/settings/website',async(req,res)=>{
  const {theme,language}=req.body;
  try{
    await db.none('UPDATE website_settings SET theme=$1,language=$2 WHERE id=1',[theme,language]);
    res.json({message:'Saved'});
  }catch(e){
    console.error(e);
    res.status(500).json({error:'Failed'});
  }
});

// Save user settings
app.post('/settings/user', auth, async (req, res) => {
  const { timezone } = req.body;
  if (!timezone) {
    return res.status(400).json({ error: 'No timezone provided.' });
  }
  try {
    await db.none(
      'UPDATE students SET timezone=$2 WHERE student_id=$1',
      [req.session.user.id, timezone]
    );
    res.json({ message: 'Saved' });
  } catch (err) {
    console.error('[ERROR] /settings/user:', err);
    res.status(500).json({ error: 'Failed' });
  }
});


// Update profile image
app.post('/update-profile-image',auth,upload.single('profileImage'),async(req,res)=>{
  if(!req.file)
    return res.status(400).json({success:false,error:'No file uploaded.'});
  try{
    const url=`/uploads/${req.file.filename}`;
    await db.none('UPDATE students SET profile_photo=$1 WHERE student_id=$2',
                  [url,req.session.user.id]);
    req.session.user.profileImage=url;
    res.json({success:true,profileImage:url});
  }catch(e){
    console.error(e);
    res.status(500).json({success:false,error:'Failed to update profile picture.'});
  }
});

// ────────────────────────────────────────────────
//                    SERVER
// ────────────────────────────────────────────────
const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log(`🚀  Server running on port ${PORT}`));
