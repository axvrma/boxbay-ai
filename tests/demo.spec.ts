import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const productionPolicy = readFileSync(new URL('../netlify.toml', import.meta.url), 'utf8')
  .match(/Content-Security-Policy = "([^"]+)"/)?.[1]

async function staticOnly(page: Page) {
  const external: string[] = []
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname !== '127.0.0.1' || url.pathname.startsWith('/api') || /replays?|shift-demo/.test(url.pathname)) {
      external.push(url.href)
      return route.abort()
    }
    if (route.request().isNavigationRequest() && productionPolicy) {
      const response = await route.fetch()
      return route.fulfill({ response, headers: { ...response.headers(), 'Content-Security-Policy': productionPolicy } })
    }
    return route.continue()
  })
  return { external, errors }
}

test('runs the live 3D presenter flow, changes forecasts, undoes placement and positions cargo', async ({ page }, info) => {
  const { external, errors } = await staticOnly(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light')
  const twin = page.getByRole('region', { name: 'Facility viewer' })
  await expect(twin.locator('canvas')).toBeVisible()
  await expect.poll(() => twin.locator('canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBeGreaterThan(500)
  await expect.poll(() => twin.locator('canvas').boundingBox()).toEqual({ x: 0, y: 0, width: 1440, height: 900 })
  expect(await page.evaluate(() => document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.tagName)).toBe('CANVAS')
  const render = await twin.locator('canvas').evaluate((canvas: HTMLCanvasElement) => ({
    width: canvas.width, height: canvas.height,
    hasWebGL2: !!canvas.getContext('webgl2'), elapsedMs: performance.now(), agent: navigator.userAgent,
  }))
  expect(render.hasWebGL2).toBe(true)
  expect(render.width).toBeGreaterThan(500)
  expect(render.height).toBeGreaterThan(250)
  console.log('3D startup profile', JSON.stringify(render))
  await expect(page.getByText('Step 1 / 4', { exact: true })).toBeVisible()
  await expect(page.getByText('JA-DEMO-001', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', {name: 'Previous'})).toBeDisabled()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 2)).toBe(true)
  await page.screenshot({ path:info.outputPath('arrival.png') })

  await page.getByRole('button', {name:'Next · Predict'}).click()
  await expect(page.getByText('Step 2 / 4', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', {name:'Recommended slot'})).toBeVisible()
  const original = await page.locator('.prediction-number').textContent()
  await page.getByLabel('Simulation date').fill('2025-03-13')
  await expect(page.locator('.prediction-number')).not.toHaveText(original!)
  await expect(page.getByText('Ramadan', { exact: true })).toBeVisible()
  await page.getByRole('button', {name:'Previous'}).click()
  await expect(page.locator('.prediction-number')).toHaveText(original!)
  await page.screenshot({ path:info.outputPath('predicted.png') })
  await page.setViewportSize({ width:1366,height:768 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 2)).toBe(true)
  await expect(page.getByRole('heading', {name:'Recommended slot'})).toBeInViewport()
  await page.setViewportSize({ width:1440, height:900 })

  await page.getByRole('button', {name:'Next · Place container'}).click()
  await expect(page.getByRole('button', {name:'Previous'})).toBeDisabled()
  await expect(page.getByText('Step 3 / 4', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', {name:'Business impact'})).toContainText('46 / 64 cells')
  await page.getByRole('button', {name:'Previous'}).click()
  await expect(page.getByRole('region', {name:'Business impact'})).toContainText('45 / 64 cells')

  await page.emulateMedia({ reducedMotion:'reduce' })
  await page.getByRole('button', {name:'Next · Place container'}).click()
  await page.getByRole('button', {name:'Next · Review optimization'}).click()
  await expect(page.getByText('Step 4 / 4', {exact:true})).toBeVisible()
  await expect(page.getByText('Net projected benefit', {exact:true})).toBeVisible()
  await page.getByRole('button', {name:'Optimize', exact:true}).click()
  await expect(page.getByText(/Last relocation · JA-YARD/)).toBeVisible()
  await expect(page.getByRole('region', {name:'Business impact'})).toContainText('2 moves')
  await page.getByRole('button', {name:'Next container'}).click()
  await expect(page.getByText('JA-DEMO-002', {exact:true})).toBeVisible()
  await expect(page.getByRole('region', {name:'Business impact'})).toContainText('46 / 64 cells')
  expect(external).toEqual([])
  expect(errors).toEqual([])
})

test('auto optimization preserves presenter control and shows a live no-action result', async ({ page }) => {
  const { external,errors } = await staticOnly(page)
  await page.emulateMedia({ reducedMotion:'reduce' })
  await page.goto('/')
  await page.getByRole('button', {name:'2D map'}).click()
  await expect(page.getByLabel('Two-dimensional storage map')).toBeVisible()
  await page.getByRole('checkbox', {name:'Auto-optimize'}).check()
  await page.getByRole('button', {name:'Next · Predict'}).click()
  await page.getByRole('button', {name:'Next · Place container'}).click()
  await expect(page.getByRole('region',{name:'Business impact'})).toContainText('2 moves')
  await expect(page.getByText('Step 3 / 4', {exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Conditions',exact:true}).click()
  await page.getByLabel('Online cranes').selectOption('0')
  await page.getByRole('button', {name:'Close conditions'}).click()
  await page.getByRole('button', {name:'Next · Review optimization'}).click()
  await expect(page.getByText(/No relocation recommended/)).toBeVisible()
  expect(external).toEqual([])
  expect(errors).toEqual([])
})

test('supports mobile, direct engineering routing, and live A/B inference', async ({ page },info) => {
  const { external,errors } = await staticOnly(page)
  await page.setViewportSize({ width:390, height:844 })
  await page.goto('/')
  const canvas = page.getByRole('region', { name: 'Facility viewer' }).locator('canvas')
  await expect.poll(() => canvas.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 })
  const details = page.getByRole('button', { name: 'Show AI details' })
  await expect(details).toHaveAttribute('aria-expanded', 'false')
  const summaryBottom = (await details.boundingBox())!
  const metricTop = (await page.getByRole('region', { name: 'Business impact' }).boundingBox())!
  expect(summaryBottom.y + summaryBottom.height).toBeLessThan(metricTop.y)
  await page.screenshot({ path: info.outputPath('mobile-3d.png') })
  await page.getByRole('button', { name: 'Next · Predict' }).click()
  await page.getByRole('button', { name: 'Show AI details' }).click()
  await expect(page.getByRole('heading', { name: 'AI prediction' })).toBeVisible()
  await page.getByRole('button', { name: 'Hide AI details' }).click()
  await page.getByRole('button', {name:'2D map'}).click()
  await expect(page.getByLabel('Two-dimensional storage map')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path:info.outputPath('mobile.png'),fullPage:true })
  await page.goto('/engineering')
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light')
  await expect(page.getByRole('heading',{name:'Engineering the live decision'})).toBeVisible()
  const current = await page.locator('.playground-card .result').last().textContent()
  await page.getByLabel('Input B arrival date').fill('2025-12-19')
  await expect(page.locator('.playground-card .result').last()).not.toHaveText(current!)
  await expect(page.getByRole('heading',{name:'Matched simulation benchmarks'})).toBeVisible()
  await expect(page.getByText('Predictive + staging', {exact:true})).toBeVisible()
  expect(external).toEqual([])
  expect(errors).toEqual([])
})

test('surfaces unavailable model artifacts', async ({ page }) => {
  await page.route('**/models/*.json', (route) => route.fulfill({status:404}))
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('Model assets unavailable')
  await expect(page.getByRole('button', {name:'Next · Predict'})).toHaveCount(0)
})


test('keeps the demo functional when WebGL is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value(kind: string, options?: unknown) {
        return kind.startsWith('webgl') || kind === 'experimental-webgl' ? null
          : Reflect.apply(original, this, [kind, options])
      },
    })
  })
  await page.goto('/')
  await expect(page.getByLabel('Two-dimensional storage map')).toBeVisible()
  await page.getByRole('button', {name:'Next · Predict'}).click()
  await expect(page.getByText('Step 2 / 4', {exact:true})).toBeVisible()
  await expect(page.getByRole('heading', {name:'Recommended slot'})).toBeVisible()
})
