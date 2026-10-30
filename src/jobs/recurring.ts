import { and, asc, eq, lte, sql } from 'drizzle-orm'
import { schema, type Db } from '#/db'
import { createId } from '#/lib/id'
import { addDays, toIsoDate } from '#/lib/invoices'
import { nextRunAfter } from '#/lib/recurring'
import {
  batch,
  incrementInvoiceNumber,
  invoiceNumberSql,
  rowCount,
} from '#/server/invoices'
import {
  sendInvoiceEmail,
  type SendInvoiceResult,
} from '#/server/invoice-email'

const { recurringSchedules, invoices, invoiceItems, clients } = schema

/** Keeps a run inside the free plan's subrequest limit; the rest run the next day. */
export const MAX_SCHEDULES_PER_RUN = 5

export interface RecurringDeps {
  apiKey: string | undefined
  from: string
  origin: string
  fetcher?: typeof fetch
}

export interface RecurringResult {
  created: number
  sent: number
  failed: number
}

/**
 * Creates one draft invoice for every active schedule that is due and moves
 * its next run date past today. The invoice, its lines, the number counter
 * and the new run date are written in one batch that only applies while the
 * schedule still has the run date that was read, so a repeated or concurrent
 * run cannot create a second invoice for the same period.
 */
export async function runRecurringSchedules(
  db: Db,
  deps: RecurringDeps,
  now: Date,
): Promise<RecurringResult> {
  const result: RecurringResult = { created: 0, sent: 0, failed: 0 }
  const today = toIsoDate(now)

  const config = await db.query.settings.findFirst()
  if (!config) return result

  const due = await db
    .select({
      schedule: recurringSchedules,
      archived: clients.archived,
    })
    .from(recurringSchedules)
    .innerJoin(clients, eq(clients.id, recurringSchedules.clientId))
    .where(
      and(
        eq(recurringSchedules.active, true),
        lte(recurringSchedules.nextRunDate, today),
      ),
    )
    .orderBy(asc(recurringSchedules.nextRunDate), asc(recurringSchedules.id))
    .limit(MAX_SCHEDULES_PER_RUN)

  for (const { schedule, archived } of due) {
    if (archived) {
      console.log(`recurring: skipped ${schedule.id}, client is archived`)
      continue
    }
    try {
      const invoiceId = createId()
      const claimed = sql`exists (select 1 from ${recurringSchedules} where ${recurringSchedules.id} = ${schedule.id} and ${recurringSchedules.active} = 1 and ${recurringSchedules.nextRunDate} = ${schedule.nextRunDate})`
      const created = sql`exists (select 1 from ${invoices} where ${invoices.id} = ${invoiceId})`
      const number = invoiceNumberSql(today)

      const [inserted] = await batch(db, [
        db
          .insert(invoices)
          .select(
            sql`select ${invoiceId}, ${number}, ${schedule.clientId}, 'draft', ${today}, ${addDays(today, config.paymentTermDays)}, ${config.currency}, ${config.taxRateBps}, 0, null, null, null, null, '', '', null, null, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where ${claimed}`,
          )
          .returning({ id: invoices.id }),
        ...schedule.items.map((item, index) =>
          db
            .insert(invoiceItems)
            .select(
              sql`select ${createId()}, ${invoiceId}, ${item.description}, ${item.quantity}, ${item.unitPrice}, ${index}, ${item.taxable === false ? 0 : 1} where ${created}`,
            ),
        ),
        incrementInvoiceNumber(db, created),
        db
          .update(recurringSchedules)
          .set({
            nextRunDate: nextRunAfter(
              schedule.nextRunDate,
              schedule.interval,
              today,
            ),
          })
          .where(
            and(
              eq(recurringSchedules.id, schedule.id),
              eq(recurringSchedules.nextRunDate, schedule.nextRunDate),
            ),
          ),
      ])
      if (rowCount(inserted) === 0) continue

      result.created++
      if (!schedule.autoSend) continue

      const sent: SendInvoiceResult = await sendInvoiceEmail(
        db,
        deps,
        invoiceId,
      )
      if (sent.ok) {
        result.sent++
      } else {
        result.failed++
        console.error(`recurring: ${schedule.id} not sent. ${sent.error}`)
      }
    } catch (error) {
      console.error(`recurring: ${schedule.id} failed`, error)
    }
  }

  return result
}
