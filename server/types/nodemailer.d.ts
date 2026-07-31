declare module 'nodemailer' {
  export interface SentMessageInfo {
    messageId: string;
    accepted: unknown[];
    rejected: unknown[];
    pending: unknown[];
    response: string;
    [key: string]: unknown;
  }

  export interface Transporter {
    sendMail(mailOptions: unknown): Promise<SentMessageInfo>;
  }

  export function createTransport(options: unknown): Transporter;

  const nodemailer: { createTransport: typeof createTransport };
  export default nodemailer;
}
