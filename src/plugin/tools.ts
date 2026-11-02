import path from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  buildCollectionPlan,
  ingestCollectionCsv,
  toPlanReport,
  type CollectionPolicyInput,
  type PlanReport,
} from '../core/collection.js'
import { defaultExportFilename, writeCollectionExport, type CollectionExportResult } from '../core/export.js'
import { writeCollectionLetters, type LettersResult } from '../core/letters.js'
import { formatCents } from '../core/money.js'
import { readCollectionSource } from '../core/source.js'

export interface ToolDeps {
  /** Local write root; the plugin uses `$DSH_HOME/dsh-ar-collection`. */
  baseDir: string
}

const text = (value: string) => [{ type: 'text' as const, text: value }]

const policyParameters = {
  path: { type: 'string' as const, required: true as const },
  as_of: { type: 'string' as const, required: true as const },
  days: { type: 'array' as const, items: { type: 'number' as const } },
  min_amount_cents: { type: 'number' as const },
  include_settled: { type: 'boolean' as const },
}

interface PolicyArgs {
  path: string
  as_of: string
  days?: number[]
  min_amount_cents?: number
  include_settled?: boolean
}

function policyInput(args: PolicyArgs): CollectionPolicyInput {
  return {
    asOf: args.as_of,
    ladderDays: args.days,
    minAmountCents: args.min_amount_cents,
    includeSettled: args.include_settled,
  }
}

async function loadPlan(args: PolicyArgs) {
  return buildCollectionPlan(ingestCollectionCsv(await readCollectionSource(args.path)), policyInput(args))
}

const invoicePlanSchema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    invoice_no: { type: 'string' as const, required: true },
    due_date: { type: 'string' as const, required: true },
    days_past_due: { type: 'number' as const, required: true },
    amount_cents: { type: 'number' as const, required: true },
    paid_cents: { type: 'number' as const, required: true },
    outstanding_cents: { type: 'number' as const, required: true },
    stage: { type: 'string' as const, required: true, enum: ['remind', 'notice', 'escalate'] },
    stage_label: { type: 'string' as const, required: true },
    next_action_date: { type: 'string' as const, required: true },
  },
} as const

const planSchema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    as_of: { type: 'string' as const, required: true },
    source_sha256: { type: 'string' as const, required: true },
    policy: {
      type: 'object' as const,
      additionalProperties: false,
      required: true,
      properties: {
        ladder_days: { type: 'array' as const, required: true, items: { type: 'number' as const } },
        min_amount_cents: { type: 'number' as const, required: true },
        include_settled: { type: 'boolean' as const, required: true },
      },
    },
    totals: {
      type: 'object' as const,
      additionalProperties: false,
      required: true,
      properties: {
        rows: { type: 'number' as const, required: true },
        open_invoices: { type: 'number' as const, required: true },
        settled_invoices: { type: 'number' as const, required: true },
        chase_invoices: { type: 'number' as const, required: true },
        chase_customers: { type: 'number' as const, required: true },
        chase_amount_cents: { type: 'number' as const, required: true },
        remind_customers: { type: 'number' as const, required: true },
        notice_customers: { type: 'number' as const, required: true },
        escalate_customers: { type: 'number' as const, required: true },
        settled_customers: { type: 'number' as const, required: true },
        below_min_customers: { type: 'number' as const, required: true },
        pre_ladder_invoices: { type: 'number' as const, required: true },
        pre_ladder_amount_cents: { type: 'number' as const, required: true },
      },
    },
    stages: {
      type: 'array' as const,
      required: true,
      items: {
        type: 'object' as const,
        additionalProperties: false,
        properties: {
          key: { type: 'string' as const, required: true, enum: ['remind', 'notice', 'escalate'] },
          label: { type: 'string' as const, required: true },
          min_days: { type: 'number' as const, required: true },
          max_days: { oneOf: [{ type: 'number' as const }, { type: 'null' as const }], required: true },
          customer_count: { type: 'number' as const, required: true },
          invoice_count: { type: 'number' as const, required: true },
          amount_cents: { type: 'number' as const, required: true },
        },
      },
    },
    customers: {
      type: 'array' as const,
      required: true,
      items: {
        type: 'object' as const,
        additionalProperties: false,
        properties: {
          priority: { type: 'number' as const, required: true },
          customer: { type: 'string' as const, required: true },
          contact_email: { type: 'string' as const, required: true },
          stage: {
            type: 'string' as const,
            required: true,
            enum: ['remind', 'notice', 'escalate', 'settled'],
          },
          stage_label: { type: 'string' as const, required: true },
          invoice_count: { type: 'number' as const, required: true },
          amount_cents: { type: 'number' as const, required: true },
          settled_invoice_count: { type: 'number' as const, required: true },
          settled_amount_cents: { type: 'number' as const, required: true },
          max_days_past_due: { type: 'number' as const, required: true },
          oldest_due_date: { type: 'string' as const, required: true },
          next_action_date: { type: 'string' as const, required: true },
          next_action: { type: 'string' as const, required: true },
          invoices: { type: 'array' as const, required: true, items: invoicePlanSchema },
        },
      },
    },
  },
} as const

const letterSchema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    priority: { type: 'number' as const, required: true },
    customer: { type: 'string' as const, required: true },
    contact_email: { type: 'string' as const, required: true },
    stage: {
      type: 'string' as const,
      required: true,
      enum: ['remind', 'notice', 'escalate', 'settled'],
    },
    stage_label: { type: 'string' as const, required: true },
    invoice_count: { type: 'number' as const, required: true },
    amount_cents: { type: 'number' as const, required: true },
    pay_by: { type: 'string' as const, required: true },
    filename: { type: 'string' as const, required: true },
    path: { type: 'string' as const, required: true },
    sha256: { type: 'string' as const, required: true },
    bytes: { type: 'number' as const, required: true },
  },
} as const

const stageCountsSchema = {
  type: 'object' as const,
  additionalProperties: false,
  required: true,
  properties: {
    remind: { type: 'number' as const, required: true },
    notice: { type: 'number' as const, required: true },
    escalate: { type: 'number' as const, required: true },
    settled: { type: 'number' as const, required: true },
  },
} as const

export function createTools(deps: ToolDeps) {
  const plan = defineTool({
    name: 'collection.plan',
    description:
      'Build a per-customer receivables collection plan from a local CSV (customer, invoice_no, due_date, amount_cents, paid_cents, contact_email). Policy: reminder ladder days=[7,15,30], min_amount_cents and include_settled. Returns chased invoice/amount counts, stage (提醒/催告/升级), next action date and priority order. Read-only.',
    parameters: policyParameters,
    output: {
      schema: planSchema,
      render: (_args, value: PlanReport) =>
        text(
          `collection plan ${value.as_of}: ${value.totals.chase_customers} customer(s) / ${value.totals.chase_invoices} invoice(s), ${formatCents(value.totals.chase_amount_cents)}; remind ${value.totals.remind_customers} / notice ${value.totals.notice_customers} / escalate ${value.totals.escalate_customers}`,
        ),
    },
    async execute(args) {
      return toPlanReport(await loadPlan(args))
    },
  })

  const letters = defineTool({
    name: 'collection.letters',
    description:
      'Generate one Chinese collection-letter draft (.txt) per customer in the plan and save it under $DSH_HOME/dsh-ar-collection/letters. Each letter has a salutation, aging summary, invoice detail table, payment deadline and contact placeholders. Local only: never sends or uploads; no network.',
    parameters: {
      ...policyParameters,
      filename_prefix: { type: 'string' as const },
    },
    output: {
      schema: {
        type: 'object' as const,
        additionalProperties: false,
        properties: {
          as_of: { type: 'string' as const, required: true },
          letter_count: { type: 'number' as const, required: true },
          total_amount_cents: { type: 'number' as const, required: true },
          letters: { type: 'array' as const, required: true, items: letterSchema },
        },
      },
      render: (_args, value: LettersResult) =>
        text(
          `wrote ${value.letter_count} collection letter draft(s), ${formatCents(value.total_amount_cents)} -> ${
            value.letters[0]?.path ?? '(none)'
          }`,
        ),
    },
    async execute(args) {
      const context = await loadPlan(args)
      return writeCollectionLetters(context, path.join(deps.baseDir, 'letters'), args.filename_prefix ?? 'letter')
    },
  })

  const exportTool = defineTool({
    name: 'collection.export',
    description:
      'Write the collection list as CSV under $DSH_HOME/dsh-ar-collection/exports: columns 客户/票号/到期日/金额/阶梯/动作日期, one row per chased invoice in priority order. include_settled=true also appends settled invoices with stage 已结清. Returns path, sha256, bytes and row counts.',
    parameters: {
      ...policyParameters,
      filename: { type: 'string' as const },
    },
    output: {
      schema: {
        type: 'object' as const,
        additionalProperties: false,
        properties: {
          path: { type: 'string' as const, required: true },
          filename: { type: 'string' as const, required: true },
          sha256: { type: 'string' as const, required: true },
          bytes: { type: 'number' as const, required: true },
          rows: { type: 'number' as const, required: true },
          as_of: { type: 'string' as const, required: true },
          customer_count: { type: 'number' as const, required: true },
          invoice_count: { type: 'number' as const, required: true },
          settled_rows: { type: 'number' as const, required: true },
          total_amount_cents: { type: 'number' as const, required: true },
          stage_counts: stageCountsSchema,
        },
      },
      render: (_args, value: CollectionExportResult) =>
        text(`collection CSV ${value.rows} row(s) -> ${value.path} (sha256 ${value.sha256.slice(0, 12)}...)`),
    },
    async execute(args) {
      const context = await loadPlan(args)
      const filename = args.filename ?? defaultExportFilename(context.asOf)
      return writeCollectionExport(context, path.join(deps.baseDir, 'exports'), filename)
    },
  })

  return [plan, letters, exportTool]
}
