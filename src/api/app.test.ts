import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, schema, type Db } from '#/db'
import { createTestD1 } from '#/db/test-db'
import { createId } from '#/lib/id'
import { serviceSchema } from '#/lib/services'
import { saveService } from '#/server/services'
import { createApi } from './app'

const SECRET = `whsec_${btoa('test-signing-secret')}`
const ORIGIN = 'https://site.example'

let db: Db
let d1: D1Database
let dispose: () => Promise<void>

beforeAll(async () => {
  const test = await createTestD1()
  d1 = test.d1
  db = createDb(d1)
  dispose = test.dispose
})

afterAll(() => dispose())

beforeEach(async () => {
  await db.delete(schema.emailLog)
  await db.delete(schema.quotes)
  await db.delete(schema.serviceDependencies)
  await db.delete(schema.serviceOptions)
  await db.delete(schema.serviceOptionGroups)
  await db.delete(schema.services)
  await db.delete(schema.settings)
  await db.insert(schema.settings).values({
    id: 'main',
    businessName: 'Acme',
    currency: 'LKR',
    taxRateBps: 1000,
  })
})

const env = {
  DB: undefined as unknown as D1Database,
  RESEND_WEBHOOK_SECRET: SECRET,
  ALLOWED_ORIGINS: ` ${ORIGIN}/ , https://other.example`,
  TURNSTILE_SECRET: 'turnstile-secret',
}
const bindings = () => ({ ...env, DB: d1 }) as unknown as Env

const turnstile = (success: boolean) =>
  (() => Promise.resolve(Response.json({ success }))) as unknown as typeof fetch

const call = (
  path: string,
  init?: RequestInit,
  options: { human?: boolean } = {},
) =>
  createApi({ fetcher: turnstile(options.human ?? true) }).request(
    path,
    init,
    bindings(),
  )

async function sign(body: string, id = 'msg_1', timestamp = Date.now() / 1000) {
  const ts = String(Math.floor(timestamp))
  const key = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(atob(SECRET.slice(6)), (c) => c.charCodeAt(0)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${id}.${ts}.${body}`),
  )
  return {
    'svix-id': id,
    'svix-timestamp': ts,
    'svix-signature': `v1,${btoa(String.fromCharCode(...new Uint8Array(mac)))}`,
  }
}

const logEmail = async (providerId: string, status = 'sent' as const) => {
  const id = createId()
  await db.insert(schema.emailLog).values({
    id,
    type: 'invoice',
    toAddress: 'a@example.com',
    status,
    providerId,
  })
  return id
}

const statusOf = async (id: string) =>
  (
    await db
      .select({ status: schema.emailLog.status })
      .from(schema.emailLog)
      .where(eq(schema.emailLog.id, id))
  )[0].status

const webhook = async (
  type: string,
  emailId: string,
  headers?: Record<string, string>,
) => {
  const body = JSON.stringify({ type, data: { email_id: emailId } })
  return call('/api/webhooks/resend', {
    method: 'POST',
    body,
    headers: headers ?? (await sign(body)),
  })
}

describe('Resend webhook', () => {
  it.each([
    ['email.delivered', 'delivered'],
    ['email.bounced', 'bounced'],
    ['email.complained', 'complained'],
  ])('maps %s to %s', async (type, status) => {
    const id = await logEmail('re_1')
    const other = await logEmail('re_2')
    const response = await webhook(type, 're_1')
    expect(response.status).toBe(200)
    expect(await statusOf(id)).toBe(status)
    expect(await statusOf(other)).toBe('sent')
  })

  it('rejects a bad signature and changes nothing', async () => {
    const id = await logEmail('re_1')
    const body = JSON.stringify({
      type: 'email.bounced',
      data: { email_id: 're_1' },
    })
    const good = await sign(body)
    const response = await call('/api/webhooks/resend', {
      method: 'POST',
      body,
      headers: { ...good, 'svix-signature': 'v1,AAAAAAAAAAAAAAAAAAAAAAAA' },
    })
    expect(response.status).toBe(401)
    expect(await statusOf(id)).toBe('sent')
  })

  it('rejects a body that differs from the signed one', async () => {
    const id = await logEmail('re_1')
    const signed = JSON.stringify({
      type: 'email.delivered',
      data: { email_id: 'other' },
    })
    const response = await call('/api/webhooks/resend', {
      method: 'POST',
      body: JSON.stringify({
        type: 'email.bounced',
        data: { email_id: 're_1' },
      }),
      headers: await sign(signed),
    })
    expect(response.status).toBe(401)
    expect(await statusOf(id)).toBe('sent')
  })

  it('rejects missing headers, a stale timestamp and a missing secret', async () => {
    const id = await logEmail('re_1')
    expect((await webhook('email.bounced', 're_1', {})).status).toBe(401)

    const body = JSON.stringify({
      type: 'email.bounced',
      data: { email_id: 're_1' },
    })
    const stale = await call('/api/webhooks/resend', {
      method: 'POST',
      body,
      headers: await sign(body, 'msg_old', Date.now() / 1000 - 3600),
    })
    expect(stale.status).toBe(401)

    const noSecret = await createApi().request(
      '/api/webhooks/resend',
      { method: 'POST', body, headers: await sign(body) },
      { ...bindings(), RESEND_WEBHOOK_SECRET: undefined } as unknown as Env,
    )
    expect(noSecret.status).toBe(401)
    expect(await statusOf(id)).toBe('sent')
  })

  it('accepts any matching entry in a multi-signature header', async () => {
    const id = await logEmail('re_1')
    const body = JSON.stringify({
      type: 'email.delivered',
      data: { email_id: 're_1' },
    })
    const headers = await sign(body)
    headers['svix-signature'] = `v1,AAAA ${headers['svix-signature']}`
    const response = await call('/api/webhooks/resend', {
      method: 'POST',
      body,
      headers,
    })
    expect(response.status).toBe(200)
    expect(await statusOf(id)).toBe('delivered')
  })

  it('does not let a late delivered event hide a bounce', async () => {
    const id = await logEmail('re_1', 'sent')
    await webhook('email.bounced', 're_1')
    await webhook('email.delivered', 're_1')
    expect(await statusOf(id)).toBe('bounced')
  })

  it('does not touch failed or pending rows', async () => {
    const failed = await logEmail('re_1', 'failed' as 'sent')
    await webhook('email.delivered', 're_1')
    expect(await statusOf(failed)).toBe('failed')
  })

  it('acknowledges unknown events and unknown email ids', async () => {
    const id = await logEmail('re_1')
    expect((await webhook('email.opened', 're_1')).status).toBe(200)
    expect((await webhook('email.bounced', 'missing')).status).toBe(200)
    expect(await statusOf(id)).toBe('sent')
  })

  it('rejects an oversized body before checking the signature', async () => {
    const body = JSON.stringify({ pad: 'x'.repeat(1024 * 1024) })
    const response = await call('/api/webhooks/resend', {
      method: 'POST',
      body,
      headers: await sign(body),
    })
    expect(response.status).toBe(413)
  })

  it('returns 400 for a signed body that is not JSON', async () => {
    const body = 'not json'
    const response = await call('/api/webhooks/resend', {
      method: 'POST',
      body,
      headers: await sign(body),
    })
    expect(response.status).toBe(400)
  })
})

const form = {
  name: 'Web',
  description: '',
  note: '',
  unitLabel: 'unit',
  unitPrice: '100',
  pricingMode: 'fixed',
  billing: 'one_time',
  categoryId: '',
  minQuantity: '1',
  maxQuantity: '',
  quantityStep: '1',
  taxable: true,
  isPrivate: false,
  estimatedDaysMin: '',
  estimatedDaysMax: '',
  requires: [],
  groups: [],
  options: [],
}

async function createService(extra: Record<string, unknown> = {}) {
  const result = await saveService(
    db,
    serviceSchema.parse({ ...form, ...extra }),
  )
  if (!result.ok) throw new Error(JSON.stringify(result))
  return result.id
}

describe('public services', () => {
  it('returns active services as JSON with CORS for an allowed origin', async () => {
    const id = await createService()
    const archived = await createService({ name: 'Old' })
    await db
      .update(schema.services)
      .set({ active: false })
      .where(eq(schema.services.id, archived))

    const response = await call('/api/public/services', {
      headers: { Origin: ORIGIN },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    const json = (await response.json()) as {
      services: { id: string }[]
      currency: string
    }
    expect(json.currency).toBe('LKR')
    expect(json.services.map((s) => s.id)).toEqual([id])
  })

  it('omits the CORS header for other origins and when none is sent', async () => {
    const denied = await call('/api/public/services', {
      headers: { Origin: 'https://evil.example' },
    })
    expect(denied.status).toBe(200)
    expect(denied.headers.get('access-control-allow-origin')).toBeNull()
    const none = await call('/api/public/services')
    expect(none.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('answers preflight only for allowed origins', async () => {
    const preflight = (origin: string) =>
      call('/api/public/quote', {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type',
        },
      })
    const allowed = await preflight('https://other.example')
    expect(allowed.headers.get('access-control-allow-origin')).toBe(
      'https://other.example',
    )
    expect(allowed.headers.get('access-control-allow-methods')).toContain(
      'POST',
    )
    const denied = await preflight('https://evil.example')
    expect(denied.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('allows no origin when ALLOWED_ORIGINS is unset', async () => {
    const response = await createApi().request(
      '/api/public/services',
      { headers: { Origin: ORIGIN } },
      { ...bindings(), ALLOWED_ORIGINS: undefined } as unknown as Env,
    )
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('does not put CORS headers on the webhook', async () => {
    const response = await call('/api/webhooks/resend', {
      method: 'POST',
      body: '{}',
      headers: { Origin: ORIGIN },
    })
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('public quote', () => {
  const post = (body: unknown, options?: { human?: boolean }, raw?: string) =>
    call(
      '/api/public/quote',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: raw ?? JSON.stringify(body),
      },
      options,
    )

  const payload = (serviceId: string, extra: Record<string, unknown> = {}) => ({
    name: 'Jo',
    email: 'jo@example.com',
    turnstileToken: 'token',
    selections: [{ serviceId, quantity: 2, optionIds: [] }],
    ...extra,
  })

  it('stores a quote with the server-calculated total', async () => {
    const id = await createService()
    const response = await post(payload(id))
    expect(response.status).toBe(201)
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    const json = (await response.json()) as { ok: boolean; id: string }
    expect(json.ok).toBe(true)
    const [row] = await db.select().from(schema.quotes)
    expect(row).toMatchObject({
      id: json.id,
      contactEmail: 'jo@example.com',
      status: 'new',
      total: 22000,
    })
  })

  it('rejects unknown fields, including a client-sent total', async () => {
    const id = await createService()
    expect((await post(payload(id, { total: 1 }))).status).toBe(400)
    expect(
      (
        await post(
          payload(id, {
            selections: [
              { serviceId: id, quantity: 1, optionIds: [], price: 1 },
            ],
          }),
        )
      ).status,
    ).toBe(400)
    expect(await db.select().from(schema.quotes)).toHaveLength(0)
  })

  it('rejects an oversized body with 413 and stores nothing', async () => {
    const id = await createService()
    const response = await post(
      payload(id, { message: 'x'.repeat(1024 * 1024) }),
    )
    expect(response.status).toBe(413)
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(await db.select().from(schema.quotes)).toHaveLength(0)
  })

  it('rejects a failed Turnstile check and stores nothing', async () => {
    const id = await createService()
    const response = await post(payload(id), { human: false })
    expect(response.status).toBe(400)
    expect(await db.select().from(schema.quotes)).toHaveLength(0)
  })

  it('rejects a missing Turnstile token, bad input and bad JSON', async () => {
    const id = await createService()
    const noToken: Record<string, unknown> = payload(id)
    delete noToken.turnstileToken
    expect((await post(noToken)).status).toBe(400)
    expect((await post(payload(id, { email: 'nope' }))).status).toBe(400)
    expect((await post(payload(id, { selections: [] }))).status).toBe(400)
    expect((await post(null, undefined, '{oops')).status).toBe(400)
    expect(await db.select().from(schema.quotes)).toHaveLength(0)
  })
})

describe('routing', () => {
  it('returns JSON 404 for unknown API paths', async () => {
    const response = await call('/api/nothing')
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not found.' })
  })

  it('does not leak internals on a server error', async () => {
    const response = await createApi().request(
      '/api/public/services',
      undefined,
      { ...bindings(), DB: undefined } as unknown as Env,
    )
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Something went wrong.' })
  })
})
