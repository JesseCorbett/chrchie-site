import { chromium } from 'playwright'
import * as cheerio from 'cheerio'
import fs from 'node:fs'
import people from './people.json' with { type: 'json' }

fs.mkdirSync('screenshots', { recursive: true })

const updates = []

const randomizedKeys = Object.keys(people).sort(() => 0.5 - Math.random())

for (const person of randomizedKeys) {
  const accounts = people[person]
  console.log(`Processing ${person}`)

  const browser = await chromium.launch()
  const page = await browser.newPage()

  if (accounts.instagram) {
    console.log(`Fetching Instagram ${accounts.instagram}`)
    try {
      const response = await fetch(`https://social-media-users-data-api-production.lightricks.org/instagram?username=${accounts.instagram}`)
      const data = await response.json()
      const followers = data.followersCount
      updates.push({ key: `${person}-instagram`, value: followers })
    } catch (e) {
      console.error(`Error fetching Instagram followers for ${accounts.instagram}:`, e)
      console.info('Falling back to manual scraping.')
      try {
        await page.goto(`https://www.instagram.com/${accounts.instagram}`)
        const container = await page.getByText('followers')
        const count = await container.locator('span').first()
        const followers = await count.innerText()
        updates.push({ key: `${person}-instagram`, value: followers })
      } catch (e) {
        console.error(`Error scraping Instagram followers for ${person}:`, e)
      } finally {
        await page.screenshot({ path: `screenshots/${person} Instagram.png` })
      }
    }
  }
  if (accounts.tiktok) {
    console.log(`Fetching Tiktok ${accounts.tiktok}`)
    try {
      await page.goto(`https://tiktok.com/@${accounts.tiktok}`)
      try {
        const refreshButton = await page.getByText('Refresh')
        await refreshButton.click()
      } catch (e) {
        // Skip if the button is not found
      }
      const count = await page.locator('strong[data-e2e="followers-count"]')
      const followers = await count.innerText()
      updates.push({ key: `${person}-tiktok`, value: followers })
    } catch (e) {
      console.error(`Error fetching Tiktok followers for ${person}:`, e)
    } finally {
      await page.screenshot({ path: `screenshots/${person} Tiktok.png` })
    }
  }
  if (accounts.x) {
    console.log(`Fetching X ${accounts.x}`)
    // X returns a blank 403 to headless Chromium, so mask the HeadlessChrome UA and client hints
    const headlessUa = await page.evaluate(() => navigator.userAgent)
    const chromeVersion = headlessUa.match(/Chrome\/(\d+)/)?.[1] ?? '140'
    const xContext = await browser.newContext({
      userAgent: headlessUa.replace('HeadlessChrome', 'Chrome'),
      extraHTTPHeaders: {
        'sec-ch-ua': `"Chromium";v="${chromeVersion}", "Google Chrome";v="${chromeVersion}", "Not-A.Brand";v="99"`,
      },
    })
    const xPage = await xContext.newPage()
    try {
      const response = await xPage.goto(`https://x.com/${accounts.x}`)
      if (!response.ok()) throw new Error(`X returned HTTP ${response.status()}`)
      const count = await xPage.locator(`a[href="/${accounts.x}/verified_followers"] > div > span:first-child`)
      const followers = await count.innerText()
      updates.push({ key: `${person}-x`, value: followers })
    } catch (e) {
      console.error(`Error fetching X followers for ${person}:`, e)
    } finally {
      await xPage.screenshot({ path: `screenshots/${person} X.png` })
      await xContext.close()
    }
  }
  if (accounts.twitch) {
    console.log(`Fetching Twitch ${accounts.twitch}`)
    try {
      await page.goto(`https://www.twitch.tv/${accounts.twitch}`)
      const count = await page.getByText(/\d+K followers/).first()
      const followers = await count.innerText()
      updates.push({ key: `${person}-twitch`, value: followers.split(' ')[0] })
    } catch (e) {
      console.error(`Error fetching Twitch followers for ${person}:`, e)
    } finally {
      await page.screenshot({ path: `screenshots/${person} Twitch.png` })
    }
  }
  if (accounts.youtube) {
    console.log(`Fetching YouTube ${accounts.youtube}`)
    try {
      await page.goto(`https://www.youtube.com/${accounts.youtube}`)
      const count = await page.getByText(/\d+K subscribers/).first()
      const followers = await count.innerText()
      updates.push({ key: `${person}-youtube`, value: followers.split(' ')[0] })
    } catch (e) {
      console.error(`Error fetching YouTube followers for ${person}:`, e)
    } finally {
      await page.screenshot({ path: `screenshots/${person} YouTube.png` })
    }
  }
  if (accounts.facebook) {
    console.log(`Fetching Facebook ${accounts.facebook}`)
    try {
      await page.goto(`https://www.facebook.com/${accounts.facebook}`)
      const count = await page.locator(`a[href*="/${accounts.facebook}/followers"] strong, a[href*="/followers"] strong`).first()
      const followers = await count.innerText()
      updates.push({ key: `${person}-facebook`, value: followers.trim() })
    } catch (e) {
      console.error(`Error fetching Facebook followers for ${person}:`, e)
    } finally {
      await page.screenshot({ path: `screenshots/${person} Facebook.png` })
    }
  }
  if (accounts.spotify) {
    // TODO
  }

  await browser.close()
}

const now = new Date().toISOString()

const platformTotals = {}
const personTotals = {}
const parseValue = (v) => {
  if (v === null || v === undefined || v === '') return 0
  let s = v.toString().replace(/,/g, '').trim().toUpperCase()
  let multiplier = 1
  if (s.endsWith('K')) {
    multiplier = 1000
    s = s.slice(0, -1)
  } else if (s.endsWith('M')) { // Optimistic, but I believe in them
    multiplier = 1000000
    s = s.slice(0, -1)
  }
  const n = parseFloat(s)
  return isNaN(n) ? 0 : n * multiplier
}

// Fall back to the last published count for anything we couldn't scrape so the totals stay roughly correct
const fallbacks = []
if (fs.existsSync('index.html')) {
  const $existing = cheerio.load(fs.readFileSync('index.html', 'utf8'))
  for (const [person, accounts] of Object.entries(people)) {
    for (const platform of Object.keys(accounts)) {
      const key = `${person}-${platform}`
      if (!accounts[platform] || updates.some(u => u.key === key)) continue
      const existing = $existing(`[data-${key}]`).first().text().trim()
      if (existing) {
        console.info(`Using existing ${key} value ${existing} for totals`)
        fallbacks.push({ key, value: existing })
      }
    }
  }
}

for (const update of [...updates, ...fallbacks]) {
  const [person, ...platformParts] = update.key.split('-')
  const platform = platformParts.join('-')
  const val = parseValue(update.value)
  personTotals[person] = (personTotals[person] || 0) + val
  platformTotals[platform] = (platformTotals[platform] || 0) + val
}

for (const [person, total] of Object.entries(personTotals)) {
  if (total > 0) {
    updates.push({ key: `${person}-total`, value: total })
  }
}

for (const [platform, total] of Object.entries(platformTotals)) {
  if (total > 0) {
    updates.push({ key: platform, value: total })
  }
}

for (const file of ['index.html', 'live.html']) {
  if (!fs.existsSync(file)) continue
  const html = fs.readFileSync(file, 'utf8')
  const $ = cheerio.load(html)

  for (const update of updates) {
    let displayValue = update.value
    const numericValue = Number(update.value?.toString()?.replace(',', ''))

    if (update.value !== null && update.value !== '' && !isNaN(numericValue)) {
      if (numericValue >= 1000) {
        displayValue = `${Math.round(numericValue / 100) / 10}K`
      } else {
        continue
      }
    }

    console.log(`Updating ${file} ${update.key} to ${displayValue}`)
    const elements = $(`[data-${update.key}]`)
    elements.text(displayValue).attr('data-updated-at', now)
  }

  fs.writeFileSync(file, $.html())
}
