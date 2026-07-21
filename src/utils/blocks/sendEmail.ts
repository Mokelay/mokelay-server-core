import nodemailer from 'nodemailer'
import { z } from 'zod'
import { mokelayError } from '../mokelay-error.js'
import { type BlockExecutor } from '../orchestration-schema.js'

export const maxEmailHtmlBytes = 5 * 1024 * 1024
export const maxEmailSubjectLength = 255
export const defaultEmailSubject = '来自 Mokelay 的页面'

const emailSchema = z.string().email()

function normalizeRecipient(value: unknown) {
  if (typeof value !== 'string') {
    throw mokelayError('BLOCK_EMAIL_INPUT_INVALID', 'to 必须是合法的单个邮箱地址。', 400)
  }
  const to = value.trim()
  if (!emailSchema.safeParse(to).success) {
    throw mokelayError('BLOCK_EMAIL_INPUT_INVALID', 'to 必须是合法的单个邮箱地址。', 400)
  }
  return to
}

function normalizeHtml(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    throw mokelayError('BLOCK_EMAIL_INPUT_INVALID', 'html 必须是非空字符串。', 400)
  }
  if (Buffer.byteLength(value, 'utf8') > maxEmailHtmlBytes) {
    throw mokelayError('BLOCK_EMAIL_INPUT_INVALID', 'html 不能超过 5MB。', 400)
  }
  return value
}

function normalizeSubject(value: unknown) {
  if (value === undefined || value === null || value === '') return defaultEmailSubject
  if (typeof value !== 'string' || !value.trim()) {
    throw mokelayError('BLOCK_EMAIL_INPUT_INVALID', 'subject 必须是非空字符串。', 400)
  }
  const subject = value.trim()
  if (/\r|\n/.test(subject)) {
    throw mokelayError('BLOCK_EMAIL_INPUT_INVALID', 'subject 不能包含换行符。', 400)
  }
  if (subject.length > maxEmailSubjectLength) {
    throw mokelayError('BLOCK_EMAIL_INPUT_INVALID', 'subject 不能超过 255 个字符。', 400)
  }
  return subject
}

function requiredConfig(name: string) {
  const value = process.env[name]?.trim()
  if (!value) {
    throw mokelayError('BLOCK_EMAIL_CONFIG_MISSING', `缺少 ${name} 配置。`, 500)
  }
  return value
}

function smtpConfig() {
  const host = requiredConfig('SMTP_HOST')
  const portValue = requiredConfig('SMTP_PORT')
  const user = requiredConfig('SMTP_USER')
  const pass = requiredConfig('SMTP_PASS')
  const port = Number(portValue)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw mokelayError('BLOCK_EMAIL_CONFIG_MISSING', 'SMTP_PORT 必须是 1 到 65535 的整数。', 500)
  }

  const secureValue = process.env.SMTP_SECURE?.trim().toLowerCase()
  if (secureValue !== undefined && secureValue !== '' && secureValue !== 'true' && secureValue !== 'false') {
    throw mokelayError('BLOCK_EMAIL_CONFIG_MISSING', 'SMTP_SECURE 只能是 true 或 false。', 500)
  }

  return {
    transport: {
      host,
      port,
      secure: secureValue ? secureValue === 'true' : port === 465,
      auth: { user, pass },
    },
    from: process.env.SMTP_FROM?.trim() || user,
  }
}

function addressStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item === 'string' && item) return [item]
    if (typeof item === 'object' && item !== null && 'address' in item && typeof item.address === 'string') {
      return [item.address]
    }
    return []
  })
}

/**
 * @serverBlockDoc
 * {
 *   "version": 1,
 *   "functionName": "sendEmail",
 *   "displayName": "发送 HTML 邮件",
 *   "category": "communication",
 *   "description": "通过 SMTP 向单个邮箱地址发送 HTML 邮件。",
 *   "inputs": [
 *     { "key": "to", "type": "string", "required": true, "description": "单个收件邮箱地址。" },
 *     { "key": "html", "type": "string", "required": true, "description": "HTML 邮件正文，最大 5MB。" },
 *     { "key": "subject", "type": "string", "required": false, "defaultValue": "来自 Mokelay 的页面", "description": "邮件主题，最大 255 个字符且不能包含换行。" }
 *   ],
 *   "outputs": [
 *     { "key": "messageId", "type": "string", "description": "SMTP provider 返回的邮件 ID。" },
 *     { "key": "accepted", "type": "string[]", "description": "SMTP 接受的收件地址。" },
 *     { "key": "rejected", "type": "string[]", "description": "SMTP 拒绝的收件地址。" }
 *   ],
 *   "errors": [
 *     { "code": "BLOCK_EMAIL_INPUT_INVALID", "description": "收件地址、HTML 或主题无效。" },
 *     { "code": "BLOCK_EMAIL_CONFIG_MISSING", "description": "SMTP 环境配置缺失或无效。" },
 *     { "code": "BLOCK_EMAIL_SEND_FAILED", "description": "SMTP 认证、网络或投递失败。" }
 *   ],
 *   "config": [
 *     { "key": "SMTP_HOST", "type": "string", "required": true, "description": "SMTP 主机。" },
 *     { "key": "SMTP_PORT", "type": "number", "required": true, "description": "SMTP 端口。" },
 *     { "key": "SMTP_USER", "type": "string", "required": true, "description": "SMTP 用户名。" },
 *     { "key": "SMTP_PASS", "type": "string", "required": true, "description": "SMTP 密码或应用专用密码。" },
 *     { "key": "SMTP_SECURE", "type": "boolean", "required": false, "description": "是否启用隐式 TLS；未配置时端口 465 自动启用。" },
 *     { "key": "SMTP_FROM", "type": "string", "required": false, "description": "发件人，默认 SMTP_USER。" }
 *   ],
 *   "runtime": [
 *     { "key": "requiresDatasource", "type": "boolean", "value": false, "description": "不需要数据库连接。" },
 *     { "key": "network", "type": "string", "value": "SMTP", "description": "会连接外部 SMTP 服务。" },
 *     { "key": "sideEffect", "type": "string", "value": "send-email", "description": "执行后会真实发送邮件。" }
 *   ],
 *   "examples": [
 *     { "title": "发送页面邮件", "block": { "uuid": "send_email", "functionName": "sendEmail", "inputs": { "to": "user@example.com", "html": { "template": "{{blocks['render_page'].outputs.html}}" } }, "outputs": ["messageId", "accepted", "rejected"], "nextBlock": null } }
 *   ]
 * }
 */
export const executeSendEmailBlock: BlockExecutor = async ({ inputs }) => {
  const to = normalizeRecipient(inputs.to)
  const html = normalizeHtml(inputs.html)
  const subject = normalizeSubject(inputs.subject)
  const config = smtpConfig()

  try {
    const transporter = nodemailer.createTransport(config.transport)
    const info = await transporter.sendMail({ from: config.from, to, subject, html })
    const accepted = addressStrings(info.accepted)
    const rejected = addressStrings(info.rejected)
    if (!accepted.includes(to) || rejected.includes(to)) {
      throw new Error('SMTP provider rejected the recipient.')
    }
    return {
      messageId: typeof info.messageId === 'string' ? info.messageId : '',
      accepted,
      rejected,
    }
  } catch (error) {
    throw mokelayError('BLOCK_EMAIL_SEND_FAILED', 'HTML 邮件发送失败。', 502, error)
  }
}
