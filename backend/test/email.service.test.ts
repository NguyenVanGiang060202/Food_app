import assert from 'node:assert/strict';
import test from 'node:test';
import { EmailService } from '../src/modules/auth/email.service';

function withEnv(values: Record<string, string | undefined>, run: () => void) {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  ) as Record<string, string | undefined>;

  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('EmailService is disabled until a sender and SMTP target are configured', () => {
  withEnv({ SMTP_FROM: undefined, SMTP_URL: undefined, SMTP_HOST: undefined }, () => {
    assert.equal(new EmailService().isConfigured(), false);
  });
});

test('EmailService supports SMTP_URL configuration', () => {
  withEnv(
    {
      SMTP_FROM: 'Food Discovery <mailer@example.com>',
      SMTP_URL: 'smtp://localhost:1025',
      SMTP_HOST: undefined,
    },
    () => {
      assert.equal(new EmailService().isConfigured(), true);
    },
  );
});

test('EmailService supports Brevo Transactional Email API configuration', () => {
  withEnv(
    {
      BREVO_API_KEY: 'test-api-key',
      MAIL_FROM_EMAIL: 'noreply@example.com',
      MAIL_FROM_NAME: 'HoiBep',
      SMTP_FROM: undefined,
      SMTP_URL: undefined,
      SMTP_HOST: undefined,
    },
    () => {
      assert.equal(new EmailService().isConfigured(), true);
    },
  );
});

test('EmailService supports host/from configuration without auth for local SMTP', () => {
  withEnv(
    {
      SMTP_FROM: 'Food Discovery <mailer@example.com>',
      SMTP_URL: undefined,
      SMTP_HOST: 'localhost',
      SMTP_USER: undefined,
      SMTP_PASSWORD: undefined,
    },
    () => {
      assert.equal(new EmailService().isConfigured(), true);
    },
  );
});
