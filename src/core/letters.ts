import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  paymentDeadline,
  STAGE_LABELS,
  type CollectionPlanContext,
  type CustomerPlan,
  type LadderStageKey,
  type StageKey,
} from './collection.js'
import { CollectionError } from './errors.js'
import { formatMoney } from './money.js'
import { safeExportPath } from './safe-path.js'

/** Letter filename prefix: one safe component, no separators or whitespace. */
export const SAFE_LETTER_PREFIX = /^[A-Za-z0-9._-]{1,40}$/

export interface LetterReport {
  priority: number
  customer: string
  contact_email: string
  stage: StageKey
  stage_label: string
  invoice_count: number
  amount_cents: number
  pay_by: string
  filename: string
  path: string
  sha256: string
  bytes: number
}

export interface LettersResult {
  as_of: string
  letter_count: number
  total_amount_cents: number
  letters: LetterReport[]
}

/**
 * Render one Chinese collection-letter draft. It is plain text on purpose: the
 * tool never sends, posts or uploads it. Every unknown human detail stays a
 * bracketed placeholder for the operator to fill in.
 */
export function renderCollectionLetter(context: CollectionPlanContext, customer: CustomerPlan): string {
  if (customer.stage === 'settled' || customer.invoiceCount === 0) {
    throw new CollectionError('E_COLLECTION_EMPTY', `客户 ${customer.customer} 没有需要催收的发票`)
  }
  const stage = customer.stage
  const payBy = paymentDeadline(context.asOfMs, stage)
  const contactLine = customer.contactEmail || '[联系人邮箱待补充]'
  const rows = customer.invoices.map(
    (entry) =>
      `${entry.invoice.invoiceNo} | ${entry.invoice.dueDate} | ${entry.daysPastDue} | ${formatMoney(entry.invoice.outstandingCents)}`,
  )
  const lines = [
    '催收函（草稿）',
    '============================================================',
    `致：${customer.customer}`,
    `联系人：${contactLine}`,
    '',
    '一、账龄摘要',
    `截至 ${context.asOf}，贵司共有 ${customer.invoiceCount} 张发票逾期未付，应催金额人民币 ${formatMoney(customer.amountCents)} 元；`,
    `最早到期日 ${customer.oldestDueDate}，最长逾期 ${customer.maxDaysPastDue} 天，当前处于「${STAGE_LABELS[stage]}」阶段。`,
    '',
    '二、明细表',
    '发票号 | 到期日 | 逾期天数 | 未收金额（元）',
    ...rows,
    `合计 | | | ${formatMoney(customer.amountCents)}`,
    '',
    '三、付款期限',
    `请于 ${payBy} 前付清上述款项，并在付款备注中注明发票号。`,
    `若逾期未付，我方将按「${STAGE_LABELS[stage]}」阶段流程继续跟进。`,
    '',
    '四、联系人',
    '联系人：[联系人姓名]',
    '电话：[联系电话]',
    `邮箱：${contactLine}`,
    '',
    '（本函由 dsh-ar-collection 在本地生成，仅为草稿；发送前请人工复核并补全占位信息。）',
  ]
  return `${lines.join('\n')}\n`
}

function letterFilename(prefix: string, index: number): string {
  return `${prefix}-${String(index).padStart(2, '0')}.txt`
}

/** Write one .txt draft per chase customer under `lettersDir`; never sends. */
export async function writeCollectionLetters(
  context: CollectionPlanContext,
  lettersDir: string,
  prefix = 'letter',
): Promise<LettersResult> {
  if (typeof prefix !== 'string' || !SAFE_LETTER_PREFIX.test(prefix)) {
    throw new CollectionError('E_COLLECTION_PATH_INVALID', `函件文件名前缀不安全：${JSON.stringify(prefix)}`)
  }
  const recipients = context.customers.filter(
    (customer): customer is CustomerPlan & { stage: LadderStageKey } =>
      customer.invoiceCount > 0 && customer.stage !== 'settled',
  )
  if (recipients.length === 0) {
    throw new CollectionError('E_COLLECTION_EMPTY', '没有需要生成催收函的客户：全部已结清')
  }

  const letters: LetterReport[] = []
  for (let index = 0; index < recipients.length; index += 1) {
    const customer = recipients[index]!
    const text = renderCollectionLetter(context, customer)
    const filename = letterFilename(prefix, index + 1)
    let filePath: string
    try {
      filePath = await safeExportPath(lettersDir, filename)
    } catch (error) {
      if (error instanceof CollectionError) throw error
      throw new CollectionError('E_COLLECTION_PATH_INVALID', String(error))
    }
    try {
      await writeFile(filePath, text, 'utf8')
    } catch (error) {
      throw new CollectionError('E_COLLECTION_PATH_INVALID', `写催收函失败：${String(error)}`)
    }
    letters.push({
      priority: customer.priority,
      customer: customer.customer,
      contact_email: customer.contactEmail,
      stage: customer.stage,
      stage_label: STAGE_LABELS[customer.stage],
      invoice_count: customer.invoiceCount,
      amount_cents: customer.amountCents,
      pay_by: paymentDeadline(context.asOfMs, customer.stage),
      filename,
      path: filePath,
      sha256: createHash('sha256').update(text).digest('hex'),
      bytes: Buffer.byteLength(text, 'utf8'),
    })
  }

  return {
    as_of: context.asOf,
    letter_count: letters.length,
    total_amount_cents: letters.reduce((sum, letter) => sum + letter.amount_cents, 0),
    letters,
  }
}

/** Convenience for callers that need the exact relative letter path. */
export function letterPathFor(lettersDir: string, prefix: string, index: number): string {
  return path.join(lettersDir, letterFilename(prefix, index))
}
