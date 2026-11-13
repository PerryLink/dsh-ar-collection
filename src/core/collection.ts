import { createHash } from 'node:crypto'
import { parseCsv } from './csv.js'
import { addDays, daysBetween, formatIsoDate, parseIsoDate } from './date.js'
import { CollectionError } from './errors.js'
import { parseCents } from './money.js'

/** Default reminder ladder: action becomes due at 7, 15 and 30 days past due. */
export const DEFAULT_LADDER_DAYS = [7, 15, 30] as const

/** Ladder stages in escalation order. `settled` is not a ladder stage. */
export type LadderStageKey = 'remind' | 'notice' | 'escalate'
/** A customer stage can additionally be `settled` when include_settled=true. */
export type StageKey = LadderStageKey | 'settled'

export interface StageDefinition {
  key: LadderStageKey
  label: '提醒' | '催告' | '升级'
  minDays: number
  maxDays: number | null
}

export const STAGE_LABELS: Record<StageKey, string> = {
  remind: '提醒',
  notice: '催告',
  escalate: '升级',
  settled: '已结清',
}

/** Day offsets used for the payment deadline printed in a collection letter. */
export const PAYMENT_GRACE_DAYS: Record<LadderStageKey, number> = {
  remind: 10,
  notice: 7,
  escalate: 3,
}

const NEXT_ACTION: Record<StageKey, string> = {
  remind: '发送催告提醒',
  notice: '发送升级催收函',
  escalate: '升级复盘并人工跟进',
  settled: '无需催收',
}

export interface ReceivableInvoice {
  customer: string
  invoiceNo: string
  dueDate: string
  amountCents: number
  paidCents: number
  outstandingCents: number
  contactEmail: string
  /** 1-based physical CSV line, useful in error details. */
  row: number
}

export interface ReceivableDataset {
  invoices: ReceivableInvoice[]
  rows: number
  customers: string[]
  totalCents: number
  paidCents: number
  outstandingCents: number
  settledRows: number
  openRows: number
  dueDateMin: string
  dueDateMax: string
  sourceSha256: string
}

type HeaderKey = 'customer' | 'invoice_no' | 'due_date' | 'amount_cents' | 'paid_cents' | 'contact_email'

const HEADER_LABELS: Record<HeaderKey, string> = {
  customer: '客户',
  invoice_no: '发票号',
  due_date: '到期日',
  amount_cents: '金额分',
  paid_cents: '已收金额分',
  contact_email: '联系人邮箱',
}

const HEADER_ALIASES: Record<HeaderKey, string[]> = {
  customer: ['customer', 'customer_name', 'customername', '客户', '客户名称'],
  invoice_no: ['invoice_no', 'invoice_number', 'invoiceno', 'invoicenumber', 'invoice', '发票号', '发票号码', '票号'],
  due_date: ['due_date', 'duedate', '到期日', '到期日期'],
  amount_cents: ['amount_cents', 'amountcents', '金额分', '应收金额分'],
  paid_cents: ['paid_cents', 'paidcents', 'paid_amount_cents', 'received_cents', '已收金额分', '已收分'],
  contact_email: ['contact_email', 'contactemail', 'email', '联系人邮箱', '邮箱', '联系人'],
}

const HEADER_ORDER: HeaderKey[] = [
  'customer',
  'invoice_no',
  'due_date',
  'amount_cents',
  'paid_cents',
  'contact_email',
]

const EMAIL_PATTERN = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/

/** Case/space/underscore/paren-insensitive header key, e.g. `已收金额(分)` -> `已收金额分`. */
function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_\-（）()]/g, '')
}

const ALIAS_TO_KEY = new Map<string, HeaderKey>()
for (const key of HEADER_ORDER) {
  for (const alias of HEADER_ALIASES[key]) ALIAS_TO_KEY.set(normalizeHeader(alias), key)
}

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Validate and normalize a receivables CSV. Every row is checked; the first
 * failure names the physical CSV line. Contact email is optional but, when
 * present, must look like an address so a letter can name a real contact.
 */
export function ingestCollectionCsv(text: string): ReceivableDataset {
  const parsed = parseCsv(text)
  if (parsed.rows.length === 0) throw new CollectionError('E_COLLECTION_EMPTY', 'CSV 是空的，没有表头')

  const header = parsed.rows[0]!
  const positions = new Map<HeaderKey, number>()
  for (let index = 0; index < header.length; index += 1) {
    const key = ALIAS_TO_KEY.get(normalizeHeader(header[index]!))
    if (!key) continue
    if (positions.has(key)) {
      throw new CollectionError('E_COLLECTION_CSV_ROW', `表头里 ${HEADER_LABELS[key]} 出现了两次`)
    }
    positions.set(key, index)
  }
  const missing = HEADER_ORDER.filter((key) => !positions.has(key))
  if (missing.length > 0) {
    throw new CollectionError(
      'E_COLLECTION_CSV_ROW',
      `表头缺少：${missing.map((key) => HEADER_LABELS[key]).join('、')}`,
    )
  }
  if (parsed.rows.length === 1) throw new CollectionError('E_COLLECTION_EMPTY', '只有表头，没有数据行')

  const invoices: ReceivableInvoice[] = []
  const seenInvoices = new Set<string>()

  for (let index = 1; index < parsed.rows.length; index += 1) {
    const row = parsed.rows[index]!
    const line = parsed.lines[index]!
    if (row.length !== header.length) {
      throw new CollectionError(
        'E_COLLECTION_CSV_ROW',
        `第 ${line} 行有 ${row.length} 列，表头有 ${header.length} 列`,
      )
    }
    const value = (key: HeaderKey): string => row[positions.get(key)!]!

    const customer = value('customer').trim()
    if (customer === '') throw new CollectionError('E_COLLECTION_CSV_ROW', `第 ${line} 行客户为空`)
    const invoiceNo = value('invoice_no').trim()
    if (invoiceNo === '') throw new CollectionError('E_COLLECTION_CSV_ROW', `第 ${line} 行发票号为空`)
    if (seenInvoices.has(invoiceNo)) {
      throw new CollectionError('E_COLLECTION_CSV_ROW', `第 ${line} 行发票号 ${invoiceNo} 重复`)
    }
    seenInvoices.add(invoiceNo)

    const dueDate = formatIsoDate(parseIsoDate(value('due_date').trim(), `第 ${line} 行到期日`))
    const amountCents = parseCents(value('amount_cents'), `第 ${line} 行金额分`, { allowZero: false })
    const paidCents = parseCents(value('paid_cents'), `第 ${line} 行已收金额分`, { allowZero: true })
    if (paidCents > amountCents) {
      throw new CollectionError(
        'E_COLLECTION_AMOUNT',
        `第 ${line} 行已收 ${paidCents} 分大于应收 ${amountCents} 分`,
      )
    }

    const contactEmail = value('contact_email').trim()
    if (contactEmail !== '' && !EMAIL_PATTERN.test(contactEmail)) {
      throw new CollectionError(
        'E_COLLECTION_CSV_ROW',
        `第 ${line} 行联系人邮箱 ${JSON.stringify(contactEmail)} 不像一个邮箱地址；没有邮箱可留空`,
      )
    }

    invoices.push({
      customer,
      invoiceNo,
      dueDate,
      amountCents,
      paidCents,
      outstandingCents: amountCents - paidCents,
      contactEmail,
      row: line,
    })
  }

  const totalCents = invoices.reduce((sum, invoice) => sum + invoice.amountCents, 0)
  const paidCents = invoices.reduce((sum, invoice) => sum + invoice.paidCents, 0)
  const outstandingCents = invoices.reduce((sum, invoice) => sum + invoice.outstandingCents, 0)
  const settledRows = invoices.filter((invoice) => invoice.outstandingCents === 0).length
  const dueDates = invoices.map((invoice) => invoice.dueDate).sort(compareText)
  const customers = [...new Set(invoices.map((invoice) => invoice.customer))].sort(compareText)

  return {
    invoices,
    rows: invoices.length,
    customers,
    totalCents,
    paidCents,
    outstandingCents,
    settledRows,
    openRows: invoices.length - settledRows,
    dueDateMin: dueDates[0]!,
    dueDateMax: dueDates.at(-1)!,
    sourceSha256: createHash('sha256').update(text).digest('hex'),
  }
}

export interface CollectionPolicyInput {
  asOf?: string
  ladderDays?: number[]
  minAmountCents?: number
  includeSettled?: boolean
}

export interface NormalizedPolicy {
  asOf: string
  asOfMs: number
  ladderDays: [number, number, number]
  minAmountCents: number
  includeSettled: boolean
}

function normalizeLadder(value: number[] | undefined): [number, number, number] {
  if (value === undefined) return [...DEFAULT_LADDER_DAYS] as [number, number, number]
  if (!Array.isArray(value) || value.length !== 3) {
    throw new CollectionError('E_COLLECTION_CSV_ROW', '提醒阶梯 days 必须是 3 个正整数，例如 [7,15,30]')
  }
  for (const day of value) {
    if (typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > 3650) {
      throw new CollectionError('E_COLLECTION_CSV_ROW', `提醒阶梯 ${JSON.stringify(day)} 不是 1–3650 的整数`)
    }
  }
  if (!(value[0]! < value[1]! && value[1]! < value[2]!)) {
    throw new CollectionError('E_COLLECTION_CSV_ROW', `提醒阶梯必须严格递增，收到 ${JSON.stringify(value)}`)
  }
  return [value[0]!, value[1]!, value[2]!]
}

/** Validate policy parameters shared by all three tools. */
export function normalizePolicy(input: CollectionPolicyInput = {}): NormalizedPolicy {
  const asOfMs = parseIsoDate(input.asOf ?? '', 'as_of')
  const ladderDays = normalizeLadder(input.ladderDays)
  const minAmountCents = input.minAmountCents ?? 0
  if (
    typeof minAmountCents !== 'number' ||
    !Number.isSafeInteger(minAmountCents) ||
    minAmountCents < 0
  ) {
    throw new CollectionError(
      'E_COLLECTION_AMOUNT',
      `最低金额 min_amount_cents ${JSON.stringify(input.minAmountCents)} 不是非负整数分`,
    )
  }
  const includeSettled = input.includeSettled ?? false
  if (typeof includeSettled !== 'boolean') {
    throw new CollectionError('E_COLLECTION_CSV_ROW', `include_settled ${JSON.stringify(includeSettled)} 不是布尔值`)
  }
  return {
    asOf: formatIsoDate(asOfMs),
    asOfMs,
    ladderDays,
    minAmountCents,
    includeSettled,
  }
}

/** The three ladder stages derived from three strictly increasing day offsets. */
export function ladderStages(ladder: readonly number[]): StageDefinition[] {
  return [
    { key: 'remind', label: '提醒', minDays: ladder[0]!, maxDays: ladder[1]! - 1 },
    { key: 'notice', label: '催告', minDays: ladder[1]!, maxDays: ladder[2]! - 1 },
    { key: 'escalate', label: '升级', minDays: ladder[2]!, maxDays: null },
  ]
}

/** Return the ladder stage for a day count, or null before the first rung. */
export function stageForDays(daysPastDue: number, ladder: readonly number[] = DEFAULT_LADDER_DAYS): LadderStageKey | null {
  const [first, second, third] = ladder
  if (first === undefined || second === undefined || third === undefined) {
    throw new CollectionError('E_COLLECTION_CSV_ROW', '提醒阶梯不足 3 档')
  }
  if (daysPastDue < first) return null
  if (daysPastDue < second) return 'remind'
  if (daysPastDue < third) return 'notice'
  return 'escalate'
}

/** Next ladder date for an invoice; the top stage reviews after the first rung. */
export function nextActionDate(dueMs: number, asOfMs: number, stage: LadderStageKey, ladder: readonly number[]): string {
  if (stage === 'remind') return formatIsoDate(addDays(dueMs, ladder[1]!))
  if (stage === 'notice') return formatIsoDate(addDays(dueMs, ladder[2]!))
  return formatIsoDate(addDays(asOfMs, ladder[0]!))
}

/** Payment deadline printed in a letter, relative to as_of and the stage. */
export function paymentDeadline(asOfMs: number, stage: LadderStageKey): string {
  return formatIsoDate(addDays(asOfMs, PAYMENT_GRACE_DAYS[stage]))
}

export interface PlannedInvoice {
  invoice: ReceivableInvoice
  daysPastDue: number
  stage: LadderStageKey
  nextActionDate: string
}

export interface CustomerPlan {
  priority: number
  customer: string
  contactEmail: string
  stage: StageKey
  invoices: PlannedInvoice[]
  settledInvoices: ReceivableInvoice[]
  invoiceCount: number
  amountCents: number
  settledInvoiceCount: number
  settledAmountCents: number
  maxDaysPastDue: number
  oldestDueDate: string
  nextActionDate: string
  nextAction: string
}

export interface PlanTotals {
  rows: number
  openInvoices: number
  settledInvoices: number
  chaseInvoices: number
  chaseCustomers: number
  chaseAmountCents: number
  remindCustomers: number
  noticeCustomers: number
  escalateCustomers: number
  settledCustomers: number
  belowMinCustomers: number
  preLadderInvoices: number
  preLadderAmountCents: number
}

export interface StageSummary {
  definition: StageDefinition
  customerCount: number
  invoiceCount: number
  amountCents: number
}

export interface CollectionPlanContext {
  asOf: string
  asOfMs: number
  policy: NormalizedPolicy
  stages: StageDefinition[]
  dataset: ReceivableDataset
  customers: CustomerPlan[]
  totals: PlanTotals
}

const STAGE_RANK: Record<StageKey, number> = { escalate: 3, notice: 2, remind: 1, settled: 0 }

/**
 * Build the single source of truth for `collection_plan`, `collection_letters`
 * and `collection_export`.
 *
 * - A chase candidate is an open invoice whose days-past-due reaches the first
 *   ladder rung; earlier open invoices stay out of the plan until they reach it.
 * - A customer's stage is the stage of its most overdue invoice.
 * - `min_amount_cents` filters whole customers by their chase total.
 * - `include_settled=true` adds settled-only customers (stage `settled`,
 *   priority after every chase customer) and exposes settled rows to export.
 */
export function buildCollectionPlan(dataset: ReceivableDataset, input: CollectionPolicyInput = {}): CollectionPlanContext {
  const policy = normalizePolicy(input)
  const stages = ladderStages(policy.ladderDays)

  const grouped = new Map<string, ReceivableInvoice[]>()
  for (const invoice of dataset.invoices) {
    const bucket = grouped.get(invoice.customer)
    if (bucket) bucket.push(invoice)
    else grouped.set(invoice.customer, [invoice])
  }

  const customers: CustomerPlan[] = []
  let belowMinCustomers = 0
  let preLadderInvoices = 0
  let preLadderAmountCents = 0

  for (const [customer, invoices] of grouped) {
    const open = invoices.filter((invoice) => invoice.outstandingCents > 0)
    const settled = invoices.filter((invoice) => invoice.outstandingCents === 0)
    const planned: PlannedInvoice[] = []
    for (const invoice of open) {
      const daysPastDue = daysBetween(parseIsoDate(invoice.dueDate, `发票 ${invoice.invoiceNo} 的到期日`), policy.asOfMs)
      const stage = stageForDays(daysPastDue, policy.ladderDays)
      if (stage === null) {
        preLadderInvoices += 1
        preLadderAmountCents += invoice.outstandingCents
        continue
      }
      planned.push({
        invoice,
        daysPastDue,
        stage,
        nextActionDate: nextActionDate(parseIsoDate(invoice.dueDate), policy.asOfMs, stage, policy.ladderDays),
      })
    }

    const amountCents = planned.reduce((sum, entry) => sum + entry.invoice.outstandingCents, 0)
    if (planned.length > 0 && amountCents < policy.minAmountCents) {
      belowMinCustomers += 1
      continue
    }

    if (planned.length === 0) {
      if (!policy.includeSettled || settled.length === 0) continue
      const settledDueDates = settled.map((invoice) => invoice.dueDate).sort(compareText)
      customers.push({
        priority: 0,
        customer,
        contactEmail: settled.find((invoice) => invoice.contactEmail !== '')?.contactEmail ?? '',
        stage: 'settled',
        invoices: [],
        settledInvoices: [...settled].sort(
          (left, right) => compareText(left.dueDate, right.dueDate) || compareText(left.invoiceNo, right.invoiceNo),
        ),
        invoiceCount: 0,
        amountCents: 0,
        settledInvoiceCount: settled.length,
        settledAmountCents: settled.reduce((sum, invoice) => sum + invoice.amountCents, 0),
        maxDaysPastDue: 0,
        oldestDueDate: settledDueDates[0] ?? '',
        nextActionDate: policy.asOf,
        nextAction: NEXT_ACTION.settled,
      })
      continue
    }

    planned.sort(
      (left, right) =>
        compareText(left.invoice.dueDate, right.invoice.dueDate) ||
        compareText(left.invoice.invoiceNo, right.invoice.invoiceNo),
    )
    const maxEntry = planned.reduce((best, entry) => (entry.daysPastDue > best.daysPastDue ? entry : best))
    const stage = maxEntry.stage
    const contactEmail =
      planned.find((entry) => entry.invoice.contactEmail !== '')?.invoice.contactEmail ??
      settled.find((invoice) => invoice.contactEmail !== '')?.contactEmail ??
      ''
    const oldestDueDate = [...planned].sort((left, right) =>
      compareText(left.invoice.dueDate, right.invoice.dueDate),
    )[0]!.invoice.dueDate
    const nextDate = planned.reduce(
      (earliest, entry) => (entry.nextActionDate < earliest ? entry.nextActionDate : earliest),
      planned[0]!.nextActionDate,
    )

    customers.push({
      priority: 0,
      customer,
      contactEmail,
      stage,
      invoices: planned,
      settledInvoices: [...settled].sort(
        (left, right) => compareText(left.dueDate, right.dueDate) || compareText(left.invoiceNo, right.invoiceNo),
      ),
      invoiceCount: planned.length,
      amountCents,
      settledInvoiceCount: settled.length,
      settledAmountCents: settled.reduce((sum, invoice) => sum + invoice.amountCents, 0),
      maxDaysPastDue: maxEntry.daysPastDue,
      oldestDueDate,
      nextActionDate: nextDate,
      nextAction: NEXT_ACTION[stage],
    })
  }

  if (customers.length === 0) {
    throw new CollectionError(
      'E_COLLECTION_EMPTY',
      '没有客户达到催收条件：检查 as_of、提醒阶梯 days、min_amount_cents，或把 include_settled 设为 true',
    )
  }

  customers.sort(
    (left, right) =>
      STAGE_RANK[right.stage] - STAGE_RANK[left.stage] ||
      right.amountCents - left.amountCents ||
      right.maxDaysPastDue - left.maxDaysPastDue ||
      compareText(left.customer, right.customer),
  )
  customers.forEach((customer, index) => {
    customer.priority = index + 1
  })

  const chaseCustomers = customers.filter((customer) => customer.invoiceCount > 0)
  const totals: PlanTotals = {
    rows: dataset.rows,
    openInvoices: dataset.openRows,
    settledInvoices: dataset.settledRows,
    chaseInvoices: chaseCustomers.reduce((sum, customer) => sum + customer.invoiceCount, 0),
    chaseCustomers: chaseCustomers.length,
    chaseAmountCents: chaseCustomers.reduce((sum, customer) => sum + customer.amountCents, 0),
    remindCustomers: chaseCustomers.filter((customer) => customer.stage === 'remind').length,
    noticeCustomers: chaseCustomers.filter((customer) => customer.stage === 'notice').length,
    escalateCustomers: chaseCustomers.filter((customer) => customer.stage === 'escalate').length,
    settledCustomers: customers.filter((customer) => customer.stage === 'settled').length,
    belowMinCustomers,
    preLadderInvoices,
    preLadderAmountCents,
  }

  return {
    asOf: policy.asOf,
    asOfMs: policy.asOfMs,
    policy,
    stages,
    dataset,
    customers,
    totals,
  }
}

export interface PlannedInvoiceReport {
  invoice_no: string
  due_date: string
  days_past_due: number
  amount_cents: number
  paid_cents: number
  outstanding_cents: number
  stage: LadderStageKey
  stage_label: string
  next_action_date: string
}

export interface CustomerPlanReport {
  priority: number
  customer: string
  contact_email: string
  stage: StageKey
  stage_label: string
  invoice_count: number
  amount_cents: number
  settled_invoice_count: number
  settled_amount_cents: number
  max_days_past_due: number
  oldest_due_date: string
  next_action_date: string
  next_action: string
  invoices: PlannedInvoiceReport[]
}

export interface StageReport {
  key: LadderStageKey
  label: string
  min_days: number
  max_days: number | null
  customer_count: number
  invoice_count: number
  amount_cents: number
}

export interface PlanTotalsReport {
  rows: number
  open_invoices: number
  settled_invoices: number
  chase_invoices: number
  chase_customers: number
  chase_amount_cents: number
  remind_customers: number
  notice_customers: number
  escalate_customers: number
  settled_customers: number
  below_min_customers: number
  pre_ladder_invoices: number
  pre_ladder_amount_cents: number
}

export interface PlanPolicyReport {
  ladder_days: number[]
  min_amount_cents: number
  include_settled: boolean
}

export interface PlanReport {
  as_of: string
  source_sha256: string
  policy: PlanPolicyReport
  totals: PlanTotalsReport
  stages: StageReport[]
  customers: CustomerPlanReport[]
}

/** Project an internal context into the public, schema-stable plan report. */
export function toPlanReport(context: CollectionPlanContext): PlanReport {
  const stageReports: StageReport[] = context.stages.map((definition) => {
    const entries = context.customers.filter((customer) => customer.stage === definition.key)
    return {
      key: definition.key,
      label: definition.label,
      min_days: definition.minDays,
      max_days: definition.maxDays,
      customer_count: entries.length,
      invoice_count: entries.reduce((sum, customer) => sum + customer.invoiceCount, 0),
      amount_cents: entries.reduce((sum, customer) => sum + customer.amountCents, 0),
    }
  })

  return {
    as_of: context.asOf,
    source_sha256: context.dataset.sourceSha256,
    policy: {
      ladder_days: [...context.policy.ladderDays],
      min_amount_cents: context.policy.minAmountCents,
      include_settled: context.policy.includeSettled,
    },
    totals: {
      rows: context.totals.rows,
      open_invoices: context.totals.openInvoices,
      settled_invoices: context.totals.settledInvoices,
      chase_invoices: context.totals.chaseInvoices,
      chase_customers: context.totals.chaseCustomers,
      chase_amount_cents: context.totals.chaseAmountCents,
      remind_customers: context.totals.remindCustomers,
      notice_customers: context.totals.noticeCustomers,
      escalate_customers: context.totals.escalateCustomers,
      settled_customers: context.totals.settledCustomers,
      below_min_customers: context.totals.belowMinCustomers,
      pre_ladder_invoices: context.totals.preLadderInvoices,
      pre_ladder_amount_cents: context.totals.preLadderAmountCents,
    },
    stages: stageReports,
    customers: context.customers.map((customer) => ({
      priority: customer.priority,
      customer: customer.customer,
      contact_email: customer.contactEmail,
      stage: customer.stage,
      stage_label: STAGE_LABELS[customer.stage],
      invoice_count: customer.invoiceCount,
      amount_cents: customer.amountCents,
      settled_invoice_count: customer.settledInvoiceCount,
      settled_amount_cents: customer.settledAmountCents,
      max_days_past_due: customer.maxDaysPastDue,
      oldest_due_date: customer.oldestDueDate,
      next_action_date: customer.nextActionDate,
      next_action: customer.nextAction,
      invoices: customer.invoices.map((entry) => ({
        invoice_no: entry.invoice.invoiceNo,
        due_date: entry.invoice.dueDate,
        days_past_due: entry.daysPastDue,
        amount_cents: entry.invoice.amountCents,
        paid_cents: entry.invoice.paidCents,
        outstanding_cents: entry.invoice.outstandingCents,
        stage: entry.stage,
        stage_label: STAGE_LABELS[entry.stage],
        next_action_date: entry.nextActionDate,
      })),
    })),
  }
}
