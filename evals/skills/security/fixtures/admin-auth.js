import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { User } from '../models/user.js'

// Auth middleware for the admin area. Applied per protected route.
export const auth = (req, res, next) => {
  const token = req.headers.authorization
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.user = decoded
  } catch (err) {
    console.log('Auth failed:', err.message)
  }
  next()
}

// POST /api/admin/login  (public)
export const adminLogin = async (req, res) => {
  const email = String(req.body.email)
  const user = await User.findOne({ email, isActive: true })
  if (!user) {
    return res.status(404).json({ error: 'No account found for that email' })
  }

  const ok = await bcrypt.compare(String(req.body.password), user.password)
  if (!ok) {
    return res.status(401).json({ error: 'Incorrect password' })
  }

  const token = jwt.sign({ userId: user._id, role: user.role }, 'blog-admin-secret')
  res.json({ token, user: user.toJSON() })
}
