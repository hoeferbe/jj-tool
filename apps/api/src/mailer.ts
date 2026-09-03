import nodemailer from 'nodemailer'

/** Payload needed to send a password-setup or password-reset e-mail. */
interface PasswordLinkMessage {
  email: string
  displayName: string
  passwordLink: string
}

interface HuntingDistrictInvitationMessage {
  email: string
  revierName: string
  inviterName: string
  invitationLink: string
}

interface RegistrationNotification {
  recipients: string[]
  displayName: string
  email: string
  revierName?: string
}

function createMailer() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, SMTP_FROM_NAME, NODE_ENV } = process.env
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD || !SMTP_FROM) {
    if (NODE_ENV === 'production') throw new Error('SMTP configuration is required in production')
    return null
  }
  return {
    transporter: nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT ?? 587),
      secure: Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
    }),
    from: { name: SMTP_FROM_NAME || 'Jagd-App', address: SMTP_FROM },
  }
}

/**
 * Sends a password-setup link via SMTP.
 * In development (no SMTP env vars set) the link is printed to stdout instead.
 * In production all four SMTP variables must be present or an error is thrown.
 */
export async function sendPasswordLink(message: PasswordLinkMessage) {
  const mailer = createMailer()
  if (!mailer) {
    console.log(`Password link for ${message.email}: ${message.passwordLink}`)
    return
  }
  await mailer.transporter.sendMail({
    from: mailer.from,
    to: message.email,
    subject: 'Passwort fuer Jagdgruppe setzen',
    text: `Hallo ${message.displayName},\n\nsetze dein Passwort ueber diesen Link. Er ist eine Stunde gueltig:\n${message.passwordLink}`,
  })
}

export async function sendHuntingDistrictInvitation(message: HuntingDistrictInvitationMessage) {
  const mailer = createMailer()
  if (!mailer) {
    console.log(`Revier invitation for ${message.email}: ${message.invitationLink}`)
    return
  }
  await mailer.transporter.sendMail({
    from: mailer.from,
    to: message.email,
    subject: `Einladung zum Revier ${message.revierName}`,
    text: `Hallo,\n\n${message.inviterName} lädt dich zum Revier ${message.revierName} in der Jagd-App ein. Die Einladung ist sieben Tage gültig:\n${message.invitationLink}`,
  })
}

export async function sendRegistrationNotification(message: RegistrationNotification) {
  if (!message.recipients.length) return
  const mailer = createMailer()
  if (!mailer) {
    console.log(`New registration for system admins: ${message.displayName} <${message.email}>`)
    return
  }
  await mailer.transporter.sendMail({
    from: mailer.from,
    to: message.recipients,
    subject: 'Neue freie Registrierung in der Jagd-App',
    text: message.revierName
      ? `${message.displayName} (${message.email}) hat sich für das Revier ${message.revierName} registriert.`
      : `${message.displayName} (${message.email}) hat sich ohne Revierzuordnung registriert und wartet auf Freigabe durch einen Systemadministrator.`,
  })
}
