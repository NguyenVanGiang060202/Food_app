import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';

@Injectable()
export class EmailService {
    private transporter?: Transporter;

    isConfigured() {
        return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD && process.env.SMTP_FROM);
    }

    async sendVerificationEmail(email: string, token: string) {
        if (!this.isConfigured()) return false;
        const origin = process.env.APP_ORIGIN ?? 'http://localhost:5173';
        await this.send({
            to: email,
            subject: 'Verify your Food Discovery account',
            text: `Verify your account: ${origin}/auth?verifyToken=${encodeURIComponent(token)}`,
            html: `<p>Verify your Food Discovery account.</p><p><a href="${origin}/auth?verifyToken=${encodeURIComponent(token)}">Verify email</a></p>`,
        });
        return true;
    }

    async sendPasswordResetEmail(email: string, token: string) {
        if (!this.isConfigured()) return false;
        const origin = process.env.APP_ORIGIN ?? 'http://localhost:5173';
        await this.send({
            to: email,
            subject: 'Reset your Food Discovery password',
            text: `Reset your password: ${origin}/auth?resetToken=${encodeURIComponent(token)}`,
            html: `<p>Reset your Food Discovery password.</p><p><a href="${origin}/auth?resetToken=${encodeURIComponent(token)}">Reset password</a></p>`,
        });
        return true;
    }

    private async send(message: { to: string; subject: string; text: string; html: string }) {
        try {
            await this.getTransporter().sendMail({ from: process.env.SMTP_FROM, ...message });
        } catch {
            throw new ServiceUnavailableException('Email delivery is temporarily unavailable.');
        }
    }

    private getTransporter() {
        if (!this.transporter) {
            const port = Number(process.env.SMTP_PORT ?? 587);
            this.transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port,
                secure: process.env.SMTP_SECURE === 'true' || port === 465,
                auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
            });
        }
        return this.transporter;
    }
}