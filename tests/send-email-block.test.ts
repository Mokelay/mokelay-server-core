import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { blockDefinitions } from '../src/utils/blocks/index.js'
import {
  defaultEmailSubject,
  executeSendEmailBlock,
  maxEmailHtmlBytes,
  maxEmailSubjectLength,
} from '../src/utils/blocks/sendEmail.js'

const smtpEnvNames = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_SECURE', 'SMTP_FROM'] as const
const originalEnv = Object.fromEntries(smtpEnvNames.map((name) => [name, process.env[name]]))
const mailMocks = vi.hoisted(() => ({ createTransport: vi.fn(), sendMail: vi.fn() }))

vi.mock('nodemailer', () => ({
  default: { createTransport: mailMocks.createTransport },
}))

function execute(inputs: Record<string, unknown>) {
  return executeSendEmailBlock({
    event: undefined as never,
    block: undefined as never,
    inputs,
    executeSql: undefined as never,
  })
}

describe('executeSendEmailBlock', () => {
  beforeEach(() => {
    mailMocks.createTransport.mockReset()
    mailMocks.sendMail.mockReset()
    mailMocks.createTransport.mockReturnValue({ sendMail: mailMocks.sendMail })
    mailMocks.sendMail.mockResolvedValue({
      messageId: '<message@example.com>',
      accepted: ['user@example.com'],
      rejected: [],
    })
    process.env.SMTP_HOST = 'smtp.example.com'
    process.env.SMTP_PORT = '465'
    process.env.SMTP_USER = 'sender@example.com'
    process.env.SMTP_PASS = 'secret-value'
    delete process.env.SMTP_SECURE
    delete process.env.SMTP_FROM
  })

  afterAll(() => {
    for (const name of smtpEnvNames) {
      const value = originalEnv[name]
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  it('sends HTML with default SMTP and message values', async () => {
    await expect(execute({ to: ' user@example.com ', html: '<h1>Hello</h1>' })).resolves.toEqual({
      messageId: '<message@example.com>',
      accepted: ['user@example.com'],
      rejected: [],
    })
    expect(mailMocks.createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      auth: { user: 'sender@example.com', pass: 'secret-value' },
    })
    expect(mailMocks.sendMail).toHaveBeenCalledWith({
      from: 'sender@example.com',
      to: 'user@example.com',
      subject: defaultEmailSubject,
      html: '<h1>Hello</h1>',
    })
  })

  it('honors explicit subject, from, and secure configuration', async () => {
    process.env.SMTP_PORT = '587'
    process.env.SMTP_SECURE = 'false'
    process.env.SMTP_FROM = 'Mokelay <mail@example.com>'
    await execute({ to: 'user@example.com', html: '<p>Page</p>', subject: 'Page result' })
    expect(mailMocks.createTransport).toHaveBeenCalledWith(expect.objectContaining({ port: 587, secure: false }))
    expect(mailMocks.sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: 'Mokelay <mail@example.com>', subject: 'Page result',
    }))
  })

  it('validates recipient, HTML, and subject before connecting', async () => {
    const cases = [
      { to: 'two@example.com,three@example.com', html: '<p>x</p>' },
      { to: 'invalid', html: '<p>x</p>' },
      { to: 'user@example.com', html: '   ' },
      { to: 'user@example.com', html: 'x'.repeat(maxEmailHtmlBytes + 1) },
      { to: 'user@example.com', html: '<p>x</p>', subject: 'Header\r\nBcc: victim@example.com' },
      { to: 'user@example.com', html: '<p>x</p>', subject: 'x'.repeat(maxEmailSubjectLength + 1) },
    ]
    for (const inputs of cases) {
      await expect(execute(inputs)).rejects.toMatchObject({ data: { code: 'BLOCK_EMAIL_INPUT_INVALID' } })
    }
    expect(mailMocks.createTransport).not.toHaveBeenCalled()
  })

  it('validates every required SMTP setting and boolean/port formats', async () => {
    for (const name of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'] as const) {
      const value = process.env[name]
      delete process.env[name]
      await expect(execute({ to: 'user@example.com', html: '<p>x</p>' })).rejects.toMatchObject({
        data: { code: 'BLOCK_EMAIL_CONFIG_MISSING' },
      })
      process.env[name] = value
    }
    process.env.SMTP_PORT = '70000'
    await expect(execute({ to: 'user@example.com', html: '<p>x</p>' })).rejects.toMatchObject({
      data: { code: 'BLOCK_EMAIL_CONFIG_MISSING' },
    })
    process.env.SMTP_PORT = '587'
    process.env.SMTP_SECURE = 'yes'
    await expect(execute({ to: 'user@example.com', html: '<p>x</p>' })).rejects.toMatchObject({
      data: { code: 'BLOCK_EMAIL_CONFIG_MISSING' },
    })
  })

  it('normalizes SMTP exceptions and rejected recipients without exposing credentials', async () => {
    mailMocks.sendMail.mockRejectedValueOnce(new Error('Authentication failed for secret-value'))
    const error = await execute({ to: 'user@example.com', html: '<p>x</p>' }).catch((value) => value)
    expect(error).toMatchObject({ message: 'HTML 邮件发送失败。', data: { code: 'BLOCK_EMAIL_SEND_FAILED' } })
    expect(JSON.stringify(error.data)).not.toContain('secret-value')

    mailMocks.sendMail.mockResolvedValueOnce({
      messageId: '<rejected@example.com>', accepted: [], rejected: ['user@example.com'],
    })
    await expect(execute({ to: 'user@example.com', html: '<p>x</p>' })).rejects.toMatchObject({
      data: { code: 'BLOCK_EMAIL_SEND_FAILED' },
    })
  })

  it('registers declared outputs without requiring a datasource', () => {
    expect(blockDefinitions.sendEmail).toMatchObject({
      allowedOutputs: ['messageId', 'accepted', 'rejected'],
    })
    expect(blockDefinitions.sendEmail?.requiresDatasource).toBeUndefined()
  })
})
