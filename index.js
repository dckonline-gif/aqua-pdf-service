const express = require('express')
const { chromium } = require('playwright')
const app = express()
app.use(express.json())

const SECRET = process.env.PDF_SECRET || 'changeme'

// AQ-CRM-164: keep one Chromium instance warm across requests so we pay the
// ~6s cold-launch cost once instead of per request.
let browserInstance = null
async function getBrowser() {
  if (!browserInstance) {
    browserInstance = await chromium.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
    // If the browser dies (Railway OOM / crash), force a relaunch on next call.
    browserInstance.on('disconnected', () => { browserInstance = null })
  }
  return browserInstance
}

app.post('/pdf', async (req, res) => {
  const { url, cookie, secret } = req.body
  if (secret !== SECRET) return res.status(401).send('Unauthorized')
  if (!url) return res.status(400).send('url required')

  let context
  let page
  try {
    const browser = await getBrowser()
    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    })
    if (cookie) await context.addCookies(cookie)
    page = await context.newPage()
    // domcontentloaded fires the moment the HTML is parsed; we don't need to
    // wait for every analytics ping that 'networkidle' was blocking on.
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(1500)
    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' },
    })
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename=document.pdf',
    })
    res.send(pdf)
  } catch (e) {
    console.error(e)
    res.status(500).send(e.message)
  } finally {
    // Tear down per-request artifacts but leave the browser warm.
    if (page) await page.close().catch(() => {})
    if (context) await context.close().catch(() => {})
  }
})

app.get('/health', (_, res) => res.send('ok'))

// Make sure the warm browser is gone before the process exits.
const shutdown = async () => {
  try { if (browserInstance) await browserInstance.close() } catch { /* ignore */ }
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

app.listen(process.env.PORT || 3001, () => console.log('PDF service running'))
