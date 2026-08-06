import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';

function frontendAuthUrl(param: 'verifyToken' | 'resetToken', token: string): string {
  const origin = (process.env.APP_ORIGIN ?? 'http://localhost:5173').replace(/\/$/, '');
  return `${origin}/auth?${param}=${encodeURIComponent(token)}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

@Injectable()
export class EmailService {
  private transporter?: Transporter;

  isConfigured() {
    return Boolean(
      (process.env.BREVO_API_KEY && this.brevoSender()) ||
        (process.env.SMTP_FROM && (process.env.SMTP_URL || process.env.SMTP_HOST)),
    );
  }

  async sendVerificationEmail(email: string, token: string) {
    if (!this.isConfigured()) return false;
    const url = frontendAuthUrl('verifyToken', token);
    await this.send({
      to: email,
      subject: 'Xác minh tài khoản Bếp',
      text: `Chào bạn,\n\nBấm liên kết sau để xác minh tài khoản Bếp: ${url}\n\nLiên kết có hiệu lực trong 24 giờ. Nếu bạn không tạo tài khoản, hãy bỏ qua email này.`,
      html: `<p>Chào bạn,</p><p>Bấm nút bên dưới để xác minh tài khoản Bếp.</p><p><a href="${escapeHtml(url)}">Xác minh email</a></p><p>Liên kết có hiệu lực trong 24 giờ. Nếu bạn không tạo tài khoản, hãy bỏ qua email này.</p>`,
    });
    return true;
  }

  async sendPasswordResetEmail(email: string, token: string) {
    if (!this.isConfigured()) return false;
    const url = frontendAuthUrl('resetToken', token);
    await this.send({
      to: email,
      subject: 'Đặt lại mật khẩu Bếp',
      text: `Chào bạn,\n\nBấm liên kết sau để đặt lại mật khẩu Bếp: ${url}\n\nLiên kết có hiệu lực trong 1 giờ. Nếu bạn không yêu cầu đổi mật khẩu, hãy bỏ qua email này.`,
      html: `<p>Chào bạn,</p><p>Bấm nút bên dưới để đặt lại mật khẩu Bếp.</p><p><a href="${escapeHtml(url)}">Đặt lại mật khẩu</a></p><p>Liên kết có hiệu lực trong 1 giờ. Nếu bạn không yêu cầu đổi mật khẩu, hãy bỏ qua email này.</p>`,
    });
    return true;
  }

  private async send(message: { to: string; subject: string; text: string; html: string }) {
    try {
      if (process.env.BREVO_API_KEY) {
        await this.sendWithBrevo(message);
        return;
      }
      await this.getTransporter().sendMail({ from: process.env.SMTP_FROM, ...message });
    } catch {
      throw new ServiceUnavailableException('Email delivery is temporarily unavailable.');
    }
  }

  private async sendWithBrevo(message: { to: string; subject: string; text: string; html: string }) {
    const sender = this.brevoSender();
    if (!sender) throw new Error('Brevo sender is not configured.');
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': process.env.BREVO_API_KEY ?? '',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender,
        to: [{ email: message.to }],
        subject: message.subject,
        textContent: message.text,
        htmlContent: message.html,
      }),
    });
    if (!response.ok) throw new Error('Brevo email delivery failed.');
  }

  private brevoSender() {
    const email = process.env.MAIL_FROM_EMAIL;
    if (!email) return null;
    return { email, name: process.env.MAIL_FROM_NAME ?? 'Bep' };
  }

  private getTransporter() {
    if (!this.transporter) {
      if (process.env.SMTP_URL) {
        this.transporter = nodemailer.createTransport(process.env.SMTP_URL);
        return this.transporter;
      }
      const port = Number(process.env.SMTP_PORT ?? 587);
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: process.env.SMTP_SECURE === 'true' || port === 465,
        ...(process.env.SMTP_USER && process.env.SMTP_PASSWORD
          ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } }
          : {}),
      });
    }
    return this.transporter;
  }
}
