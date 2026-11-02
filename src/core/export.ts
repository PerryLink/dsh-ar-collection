import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { STAGE_LABELS, type CollectionPlanContext } from './collection.js'
import { toCsv } from './csv.js'
import { CollectionError } from './errors.js'
import { formatCents } from './money.js'
import { safeExportPath } from './safe-path.js'

/** Exactly the six columns requested for a collection list. */
export const COLLECTION_EXPORT_HEADER = ['客户', '票号', '到期日', '金额', '阶梯', '动作日期'] as const

export interface StageCounts {
  remind: number
  notice: number
  escalate: number
  settled: number
}

export interface CollectionExportResult {
  path: string
  filename: string
  sha256: string
  bytes: number
  rows: number
  as_of: string
  customer_count: number
  invoice_count: number
  settled_rows: number
  total_amount_cents: number
  stage_counts: StageCounts
}

/**
 * Build the collection-list CSV in priority order. One row per chase invoice;
 * with `include_settled=true`, settled invoices follow their customer's chase
 * rows with stage `已结清` and an empty action date.
 */
export function collectionListCsv(context: CollectionPlanContext): string {
  const rows: string[][] = [[...COLLECTION_EXPORT_HEADER]]
  for (const customer of context.customers) {
    for (const entry of customer.invoices) {
      rows.push([
        customer.customer,
        entry.invoice.invoiceNo,
        entry.invoice.dueDate,
        formatCents(entry.invoice.outstandingCents),
        STAGE_LABELS[entry.stage],
        entry.nextActionDate,
      ])
    }
    if (context.policy.includeSettled) {
      for (const invoice of customer.settledInvoices) {
        rows.push([
          customer.customer,
          invoice.invoiceNo,
          invoice.dueDate,
          formatCents(invoice.outstandingCents),
          STAGE_LABELS.settled,
          '',
        ])
      }
    }
  }
  return toCsv(rows)
}

/** Write the collection-list CSV under `exportsDir` and return its hash/metadata. */
export async function writeCollectionExport(
  context: CollectionPlanContext,
  exportsDir: string,
  filename: string,
): Promise<CollectionExportResult> {
  const csv = collectionListCsv(context)
  let filePath: string
  try {
    filePath = await safeExportPath(exportsDir, filename)
  } catch (error) {
    if (error instanceof CollectionError) throw error
    throw new CollectionError('E_COLLECTION_PATH_INVALID', String(error))
  }
  try {
    await writeFile(filePath, csv, 'utf8')
  } catch (error) {
    throw new CollectionError('E_COLLECTION_PATH_INVALID', `写催收清单失败：${String(error)}`)
  }

  const stageCounts: StageCounts = { remind: 0, notice: 0, escalate: 0, settled: 0 }
  let invoiceCount = 0
  let settledRows = 0
  for (const customer of context.customers) {
    for (const entry of customer.invoices) {
      stageCounts[entry.stage] += 1
      invoiceCount += 1
    }
    if (context.policy.includeSettled) {
      stageCounts.settled += customer.settledInvoices.length
      settledRows += customer.settledInvoices.length
    }
  }

  return {
    path: filePath,
    filename,
    sha256: createHash('sha256').update(csv).digest('hex'),
    bytes: Buffer.byteLength(csv, 'utf8'),
    rows: invoiceCount + settledRows,
    as_of: context.asOf,
    customer_count: context.customers.length,
    invoice_count: invoiceCount,
    settled_rows: settledRows,
    total_amount_cents: context.totals.chaseAmountCents,
    stage_counts: stageCounts,
  }
}

/** Default safe filename for a collection export. */
export function defaultExportFilename(asOf: string): string {
  return `collection-${asOf}.csv`
}

/** Expose the resolved export path helper to tests without duplicating rules. */
export function exportPathFor(exportsDir: string, filename: string): string {
  return path.join(exportsDir, filename)
}
