const express = require('express')
const { chromium } = require('playwright')
const app = express()
app.use(express.json())

const SECRET = process.env.PDF_SECRET || 'changeme'

app.post('/pdf', async (req, res) => {
  const { url, cookie, secret } = req.body
  if (secret !== SECRET) return res.status(401).send('Unauthorized')
  if (!url) return res.status(400).send('url required')

  let browser
  try {
    browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] })
    const context = await browser.newContext()
    if (cookie) await context.addCookies(cookie)
    const page = await context.newPage()
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(2000)
    const pdf = await page.pdf({ format: 'Letter', printBackground: true, margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' } })
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename=document.pdf' })
    res.send(pdf)
  } catch (e) {
    console.error(e)
    res.status(500).send(e.message)
  } finally {
    if (browser) await browser.close()
  }
})

app.get('/health', (_, res) => res.send('ok'))
app.listen(process.env.PORT || 3001, () => console.log('PDF service running'))
