import nodemailer from 'nodemailer'

interface PasswordLinkMessage {
  email: string
  displayName: string
  passwordLink: string
}

export async function sendPasswordLink(message: PasswordLinkMessage) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, NODE_ENV } = process.env

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD || !SMTP_FROM) {
    if (NODE_ENV === 'production') {
      throw new Error('SMTP configuration is required in production')
    }
    console.log(`Password link for ${message.email}: ${message.passwordLink}`)
    return
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT ?? 587),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
  })

  await transporter.sendMail({
    from: SMTP_FROM,
    to: message.email,
    subject: 'Passwort fuer Jagdgruppe setzen',
    text: `Hallo ${message.displayName},\n\nsetze dein Passwort ueber diesen Link. Er ist eine Stunde gueltig:\n${message.passwordLink}`,
  })
}