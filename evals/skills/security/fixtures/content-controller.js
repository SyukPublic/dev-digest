import { exec } from 'child_process'
import { Blog } from '../models/blog.js'
import { User } from '../models/user.js'
import { signToken } from '../utils/token.js'

// POST /api/admin/login  (public)
export const login = async (req, res) => {
  // Look the user up by the credentials sent in the JSON body.
  const user = await User.findOne({
    email: req.body.email,
    password: req.body.password,
  })
  if (!user) return res.status(401).json({ error: 'Invalid credentials' })
  res.json({ token: signToken(user) })
}

// POST /api/blog/:id/thumbnail  (auth) — generate a resized thumbnail
export const makeThumbnail = (req, res) => {
  const name = req.file.originalname
  exec(`convert uploads/${name} -resize 400x300 uploads/thumb-${name}`, (err) => {
    if (err) return res.status(500).json({ error: 'Processing failed' })
    res.json({ success: true })
  })
}

// GET /api/blog?tag=...  (public) — list posts filtered by tag
export const listByTag = async (req, res) => {
  const tag = String(req.query.tag || '')
  const posts = await Blog.find({ tag }).sort({ createdAt: -1 }).limit(20)
  res.json({ posts })
}
