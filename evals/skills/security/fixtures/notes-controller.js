import fetch from 'node-fetch'
import { Note } from '../models/note.js'
import { asyncHandler } from '../utils/async-handler.js'

// DELETE /api/notes/:id  (auth required)
export const deleteNote = asyncHandler(async (req, res) => {
  const note = await Note.findByIdAndDelete(req.params.id)
  if (!note) return res.status(404).json({ error: 'Not found' })
  res.json({ success: true })
})

// GET /api/notes/:id/enrich  (auth required) — pull extra data from the internal service
export const enrichNote = asyncHandler(async (req, res) => {
  const note = await Note.findById(req.params.id)
  if (!note) return res.status(404).json({ error: 'Not found' })
  if (note.author.toString() !== req.user.userId) {
    return res.status(403).json({ error: 'Not authorized' })
  }

  const meta = await fetch(`${process.env.ENRICHMENT_URL}/meta`, {
    signal: AbortSignal.timeout(5000),
  }).then((r) => (r.ok ? r.json() : {}))
  res.json({ note, meta })
})

// Global error handler (mounted last)
export const errorHandler = (err, req, res, next) => {
  logger.error({ event: 'unhandled_error', message: err.message, url: req.url })
  const status = err.statusCode || 500
  res.status(status).json({
    success: false,
    message: status === 500 ? 'Internal Server Error' : err.message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  })
}
