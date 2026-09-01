import nodemailer from 'nodemailer'

/** Payload needed to send a password-setup or password-reset e-mail. */
interface PasswordLinkMessage {
  email: string
  displayName: string
  passwordLink: string
}

/**
 * Sends a password-setup link via SMTP.
 * In development (no SMTP env vars set) the link is printed to stdout instead.
 * In production all four SMTP variables must be present or an error is thrown.
 */
export async function sendPasswordLink(message: PasswordLinkMessage) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, NODE_ENV } = process.env

  // Fall back to console output in development to avoid requiring a mail server.
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD || !SMTP_FROM) {
    if (NODE_ENV === 'production') {
      throw new Error('SMTP configuration is required in production')
    }
    console.log(`Password link for ${message.email}: ${message.passwordLink}`)
    return
  }

  // Port 465 uses implicit TLS; all other ports use STARTTLS.
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
