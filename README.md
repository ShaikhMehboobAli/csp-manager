# CSP Manager — API Server & Deployment Guide

Production-ready backend API service for **CSP Manager**, built with Node.js, Express, TypeScript, and Prisma ORM with PostgreSQL.

---

## Table of Contents

- [Overview & Architecture](#overview--architecture)
- [Repository Structure](#repository-structure)
- [Prerequisites](#prerequisites)
- [DigitalOcean VPS Setup Guide](#digitalocean-vps-setup-guide)
  - [Step 1: Droplet Setup & Security](#step-1-droplet-setup--security)
  - [Step 2: Install Node.js, PM2, and Nginx](#step-2-install-nodejs-pm2-and-nginx)
  - [Step 3: Clone Repository](#step-3-clone-repository)
  - [Step 4: Configure Environment Variables](#step-4-configure-environment-variables)
  - [Step 5: Install Dependencies & Build](#step-5-install-dependencies--build)
  - [Step 6: Run Database Migrations & Seeds](#step-6-run-database-migrations--seeds)
  - [Step 7: Start Application with PM2](#step-7-start-application-with-pm2)
  - [Step 8: Configure Nginx Reverse Proxy](#step-8-configure-nginx-reverse-proxy)
  - [Step 9: Setup Free SSL (Let's Encrypt / Certbot)](#step-9-setup-free-ssl-lets-encrypt--certbot)
  - [Step 10: Health Check & Verification](#step-10-health-check--verification)
- [Updating the Application (Continuous Deployment)](#updating-the-application-continuous-deployment)
- [PM2 Process Management & Logs](#pm2-process-management--logs)
- [Background Cron Jobs & Architecture Notes](#background-cron-jobs--architecture-notes)
- [Troubleshooting & FAQs](#troubleshooting--faqs)

---

## Overview & Architecture

- **Runtime:** Node.js (v20+ or v22+ LTS)
- **Framework:** Express 5.x & TypeScript
- **Database:** PostgreSQL (Neon / DigitalOcean Managed PostgreSQL / Self-hosted)
- **ORM:** Prisma 6.x (configured with `relationJoins` preview feature)
- **Process Manager:** PM2 (Single-instance fork mode for background jobs)
- **Reverse Proxy & SSL:** Nginx + Let's Encrypt Certbot
- **Storage & Integrations:** AWS S3 (receipt slips/files), Razorpay (payments/mandates), Resend (emails/OTPs), Firebase Cloud Messaging (push notifications)

---

## Repository Structure

```text
csp-manager/
├── apps/
│   └── api/
│       ├── prisma/
│       │   ├── schema.prisma       # Database schema & models
│       │   ├── migrations/         # SQL migration history
│       │   ├── seed.ts             # Main seed script
│       │   └── seeds/              # Super admin, plans, pricing seeds
│       ├── src/
│       │   ├── config/             # Environment & DB configurations
│       │   ├── core/               # Middleware, security, JWT, rate-limiting
│       │   ├── jobs/               # In-process scheduled cron jobs
│       │   ├── modules/            # Domain modules (auth, machines, receipts, payments...)
│       │   ├── app.ts              # Express application setup
│       │   └── server.ts           # Server bootstrap & DB connection
│       ├── .env.example            # Environment configuration template
│       ├── package.json            # API dependencies & scripts
│       └── tsconfig.json           # TypeScript configuration
├── docs/                           # Architecture, API & pre-production checklists
├── ecosystem.config.js             # PM2 process manager configuration
├── nginx.conf.example              # Nginx reverse proxy configuration template
├── deploy.sh                       # One-click zero-downtime deployment script
├── .env.example                    # Root environment template
└── package.json                    # Root helper scripts
```

---

## Prerequisites

Before starting deployment on DigitalOcean, ensure you have:

1. **DigitalOcean Account**: A droplet running **Ubuntu 22.04 LTS or 24.04 LTS**.
   - _Recommended Spec:_ Minimum 1 GB RAM (with 2 GB Swap) or 2 GB+ RAM.
2. **Domain / Subdomain**: An `A` record pointing to your Droplet's public IP address (e.g., `api.yourdomain.com` &rarr; `159.xxx.xxx.xxx`).
3. **PostgreSQL Database**:
   - DigitalOcean Managed PostgreSQL, Neon DB (`ap-southeast-1` recommended for low latency), or self-hosted PostgreSQL.
4. **Third-party Services** (Optional for boot, required for full features):
   - **Razorpay**: Key ID, Key Secret, Webhook Secret (for payments).
   - **Resend**: API Key and verified domain sender (for transactional OTPs/emails).
   - **AWS S3**: Bucket, IAM Access Key, Secret Key (for receipt slip uploads).
   - **Firebase**: Service Account JSON (for push notifications).

---

## DigitalOcean VPS Setup Guide

### Step 1: Droplet Setup & Security

Log in to your DigitalOcean droplet as `root`:

```bash
ssh root@YOUR_DROPLET_IP
```

#### 1. Update system packages

```bash
sudo apt update && sudo apt upgrade -y
```

#### 2. Create the `cspmanager` user

```bash
# Create user 'cspmanager'
adduser cspmanager

# Grant sudo privileges
usermod -aG sudo cspmanager

# Switch to the new user
su - cspmanager
```

#### 3. Configure 2 GB Swap Memory

> [!TIP]
> TypeScript compilation (`tsc`) and `npm install` require spikes of memory. If using a 1 GB or 2 GB RAM Droplet, adding a swap file prevents out-of-memory errors.

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Make swap permanent across reboots
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Check swap status
free -h
```

#### 4. Configure UFW Firewall

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

---

### Step 2: Install Node.js, PM2, and Nginx

#### 1. Install Node.js 20 LTS (or Node.js 22 LTS)

```bash
# Add NodeSource repository
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

# Install Node.js
sudo apt install -y nodejs build-essential git

# Verify installation
node -v   # Should show v20.x.x
npm -v    # Should show 10.x.x+
```

#### 2. Install PM2 globally

```bash
sudo npm install -g pm2
```

#### 3. Install Nginx and Certbot

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

---

### Step 3: Clone Repository

We use `/home/cspmanager/apps` as the base folder for applications on the server, with the repository cloned into `/home/cspmanager/apps/csp-manager`:

```bash
# Ensure base apps directory exists under cspmanager user
mkdir -p /home/cspmanager/apps
cd /home/cspmanager/apps

# Clone repository into /home/cspmanager/apps/csp-manager
git clone <YOUR_GIT_REPO_URL> csp-manager
cd /home/cspmanager/apps/csp-manager
```

---

### Step 4: Configure Environment Variables

Copy the example environment configuration into `apps/api/.env`:

```bash
cp .env.example apps/api/.env
nano apps/api/.env
```

#### Essential Environment Variables:

| Variable                  | Description                      | Example / Recommended Value                                         |
| :------------------------ | :------------------------------- | :------------------------------------------------------------------ |
| `NODE_ENV`                | Environment mode                 | `production`                                                        |
| `PORT`                    | Local port Express listens on    | `3000`                                                              |
| `API_PREFIX`              | Prefix for API routes            | `/api/v1`                                                           |
| `TRUST_PROXY`             | Proxy hop count (Nginx is 1 hop) | `1` _(Required so rate-limiting captures real user IPs)_            |
| `DATABASE_URL`            | PostgreSQL connection string     | `postgresql://user:pass@host:5432/db?schema=public&sslmode=require` |
| `JWT_SECRET`              | Secret key for access tokens     | Generated via `openssl rand -hex 32`                                |
| `JWT_REFRESH_SECRET`      | Secret key for refresh tokens    | Generated via `openssl rand -hex 32`                                |
| `JWT_ACCESS_EXPIRES_IN`   | Access token lifespan            | `15m`                                                               |
| `JWT_REFRESH_EXPIRES_IN`  | Refresh token lifespan           | `7d`                                                                |
| `SUPER_ADMIN_EMAIL`       | Initial super admin email        | `admin@yourdomain.com`                                              |
| `SUPER_ADMIN_PASSWORD`    | Initial super admin password     | _Must be &ge; 12 characters_                                        |
| `SUPER_ADMIN_AGENT_ID`    | Admin ID handle                  | `SUPERADMIN`                                                        |
| `RAZORPAY_KEY_ID`         | Razorpay Live/Test Key ID        | `rzp_live_xxxxxxxx`                                                 |
| `RAZORPAY_KEY_SECRET`     | Razorpay Secret                  | Razorpay dashboard secret                                           |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook verification secret      | Set in Razorpay webhook dashboard                                   |
| `RESEND_API_KEY`          | Transactional email provider key | `re_xxxxxxxx`                                                       |
| `EMAIL_FROM`              | Sender address                   | `"CSP Manager <noreply@yourdomain.com>"`                            |
| `AWS_REGION`              | AWS S3 region for files          | `ap-south-1`                                                        |
| `AWS_S3_BUCKET`           | AWS S3 Bucket Name               | `csp-manager-uploads`                                               |
| `AWS_ACCESS_KEY_ID`       | AWS IAM Access Key               | `AKIA...`                                                           |
| `AWS_SECRET_ACCESS_KEY`   | AWS IAM Secret Key               | Secret key                                                          |
| `CLEANUP_DRY_RUN`         | Cron cleanup execution           | `false` _(deletes expired data in production)_                      |

> [!TIP]
> Generate secure random JWT keys quickly in your terminal:
>
> ```bash
> openssl rand -hex 32
> ```

---

### Step 5: Install Dependencies & Build

```bash
cd /home/cspmanager/apps/csp-manager/apps/api

# 1. Install all dependencies (including devDependencies required for tsc build)
npm install --include=dev

# 2. Generate Prisma Client (builds to apps/api/src/generated/prisma)
npx prisma generate

# 3. Compile TypeScript to JavaScript (builds to apps/api/dist)
npm run build
```

---

### Step 6: Run Database Migrations & Seeds

> [!IMPORTANT]
> Never run `prisma migrate dev` on a production database. Always use `prisma migrate deploy`.

```bash
cd /home/cspmanager/apps/csp-manager/apps/api

# Apply all database migrations
npx prisma migrate deploy

# Run the database seeds (Initial plans, pricing, metrics, features, and Super Admin)
npx prisma db seed
```

If you only need to create or reset the Super Admin account separately:

```bash
npm run seed:super-admin
```

---

### Step 7: Start Application with PM2

The repository includes a production-ready `ecosystem.config.js`.

> [!NOTE]
> **Why 1 Fork Instance?**
> The CSP Manager API runs 11 scheduled in-process cron jobs (subscription renewals, session timeout sweeps, receipt retention, machine offline alerts, etc.) and uses in-memory rate limiting and nonce validation. Running in **fork mode with 1 instance** ensures scheduled jobs do not run duplicate concurrent charges or database operations.

From the repository root:

```bash
cd /home/cspmanager/apps/csp-manager

# Start the application using PM2 in production mode
pm2 start ecosystem.config.js --env production

# Check application status
pm2 status

# Save PM2 process list so it automatically restarts on system reboots
pm2 save

# Setup PM2 startup script on systemd
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u cspmanager --hp /home/cspmanager
```

---

### Step 8: Configure Nginx Reverse Proxy

Copy the provided Nginx configuration template:

```bash
sudo cp /home/cspmanager/apps/csp-manager/nginx.conf.example /etc/nginx/sites-available/csp-manager.conf
```

Edit the file to match your domain name:

```bash
sudo nano /etc/nginx/sites-available/csp-manager.conf
```

Replace `api.yourdomain.com` with your real domain:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name api.yourdomain.com;

    client_max_body_size 10M;

    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable the site in Nginx:

```bash
# Create symlink in sites-enabled
sudo ln -s /etc/nginx/sites-available/csp-manager.conf /etc/nginx/sites-enabled/

# Remove default Nginx site if present
sudo rm -f /etc/nginx/sites-enabled/default

# Test Nginx configuration syntax
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

---

### Step 9: Setup Free SSL (Let's Encrypt / Certbot)

Generate an automatic SSL certificate for your domain:

```bash
sudo certbot --nginx -d api.yourdomain.com
```

- Follow the prompts to enter your email address and agree to the Terms of Service.
- Certbot will automatically adjust your Nginx config for HTTPS and configure automatic certificate renewal.

Test automatic renewal:

```bash
sudo certbot renew --dry-run
```

---

### Step 10: Health Check & Verification

Test your live endpoint:

```bash
curl -I https://api.yourdomain.com/
```

Expected response:

```http
HTTP/2 200
content-type: text/html; charset=utf-8
...
CSP Manager API Running 🚀
```

---

## Updating the Application (Continuous Deployment)

The repository provides an automated zero-downtime deployment script: `deploy.sh`.

Whenever you push new code to Git, update the live server in one command:

```bash
cd /home/cspmanager/apps/csp-manager
./deploy.sh
```

### What `deploy.sh` does automatically:

1. Performs `git pull` to fetch latest code.
2. Runs `npm install --include=dev` in `apps/api`.
3. Re-generates Prisma client via `npx prisma generate`.
4. Runs pending database migrations with `npx prisma migrate deploy`.
5. Builds fresh TypeScript code into `dist/` with `npm run build`.
6. Reloads PM2 seamlessly (`pm2 reload ecosystem.config.js --env production`).

---

## PM2 Process Management & Logs

### Common PM2 Commands:

```bash
# Check status of running processes
pm2 status

# View real-time aggregated logs
pm2 logs csp-manager-api

# View last 100 log lines
pm2 logs csp-manager-api --lines 100

# Monitor CPU, Memory, and Event Loop in real-time
pm2 monit

# Reload without dropping connections (zero-downtime)
pm2 reload ecosystem.config.js --env production

# Restart the application
pm2 restart csp-manager-api

# Stop the application
pm2 stop csp-manager-api
```

### Automatic Log Rotation

To prevent log files from filling up your server's disk space over time, install the `pm2-logrotate` module:

```bash
pm2 install pm2-logrotate

# Configure retention (keep 7 days of logs, rotate at 20MB)
pm2 set pm2-logrotate:max_size 20M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

---

## Background Cron Jobs & Architecture Notes

The API starts 11 background maintenance jobs automatically on bootstrap:

| Job                         | File                             | Purpose                                                                       |
| :-------------------------- | :------------------------------- | :---------------------------------------------------------------------------- |
| **Machine Session Timeout** | `machine-session-timeout.job.ts` | Closes active machine sessions if heartbeats lapse.                           |
| **Machine Session Cleanup** | `machine-session-cleanup.job.ts` | Cleans up historical session records based on retention setting.              |
| **Subscription Expiry**     | `subscription-expiry.job.ts`     | Expires past-due plans and manages grace periods.                             |
| **Subscription Renewal**    | `subscription-renewal.job.ts`    | Triggers UPI AutoPay mandate recurring charges.                               |
| **Trial Reminder**          | `trial-reminder.job.ts`          | Sends reminders before free trials expire.                                    |
| **Receipt Retention**       | `receipt-retention.job.ts`       | Cleans up raw receipt rows older than N days (keeps daily counts for 1 year). |
| **Machine Offline Alert**   | `machine-offline-alert.job.ts`   | Sends alerts when a machine stops sending heartbeats during business hours.   |
| **Day Close Reminder**      | `day-close-reminder.job.ts`      | Reminds operators to close their cash day before closing time.                |
| **Diagnostics Cleanup**     | `diagnostics-cleanup.job.ts`     | Removes uploaded diagnostic logs after retention window.                      |
| **CSP Activity Timeout**    | `csp-activity-timeout.job.ts`    | Closes idle CSP agent sessions.                                               |
| **Email Log Cleanup**       | `email-log-cleanup.job.ts`       | Prunes old transactional email audit logs.                                    |

---

## Troubleshooting & FAQs

### 1. Build fails with `JavaScript heap out of memory` during `tsc`

- **Cause:** DigitalOcean Droplet has 1 GB or 2 GB RAM and ran out of memory compiling TypeScript.
- **Fix:** Ensure you configured the 2 GB Swap file described in [Step 1](#3-configure-2-gb-swap-memory).

### 2. Prisma error: `Cannot find module '../generated/prisma/client'`

- **Cause:** TypeScript was compiled before Prisma generated its client files.
- **Fix:**
  ```bash
  cd apps/api
  npx prisma generate
  npm run build
  ```

### 3. Rate-limiter (429 Too Many Requests) triggers for everyone

- **Cause:** Behind Nginx, `req.ip` resolves to `127.0.0.1` because `TRUST_PROXY` is not set.
- **Fix:** In `apps/api/.env`, ensure `TRUST_PROXY=1` is set, and restart PM2.

### 4. Database connections drop or timeout

- **Cause:** Remote PostgreSQL (Neon/Managed DB) connection limits or network latency.
- **Fix:**
  - Ensure `DATABASE_URL` includes `?sslmode=require`.
  - On Neon or managed databases, connect via the **pooled** connection string (port 6543 / pgbouncer) or ensure the connection timeout is &ge; 15s.

### 5. Check live application error logs

```bash
cat /home/cspmanager/apps/csp-manager/apps/api/logs/error.log
```

or

```bash
pm2 logs csp-manager-api --err
```

---

## License

Internal proprietary software for CSP Manager. All rights reserved.
