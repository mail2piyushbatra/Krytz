# Krytz Cloud Deployment Plan

This guide outlines how to take the local `docker-compose.yml` stack and deploy it to a production cloud environment, using a lightweight VPS provider like DigitalOcean.

## 1. Infrastructure Preparation

1.  **Provision a Server (Droplet)**
    *   **Provider**: DigitalOcean / AWS EC2 / Hetzner.
    *   **Specs**: Minimum 2 vCPUs, 4GB RAM (to comfortably run Node.js, Postgres with pgvector, Redis, and MinIO).
    *   **OS**: Ubuntu 24.04 LTS.
2.  **Domain & Networking**
    *   Point your domain (e.g., `krytz.app` or `api.krytz.app`) to the server's public IP address via A-records.

## 2. Server Configuration

1.  **Install Dependencies**
    *   Install Docker and Docker Compose on the server.
    *   Install Nginx (or Caddy) to act as a reverse proxy and handle SSL termination.
2.  **Clone the Repository**
    *   Clone the Krytz repository onto the server.
    *   Navigate to the repository directory.

## 3. Environment Variables (.env)

Create a production `.env` file based on `.env.example`. 
**CRITICAL CHANGES FOR PRODUCTION:**
*   `NODE_ENV=production`
*   `JWT_SECRET` and `JWT_REFRESH_SECRET`: Generate strong, random 64-character hex strings.
*   `POSTGRES_PASSWORD`: Use a strong password.
*   `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD`: Secure credentials for object storage.
*   `OPENAI_API_KEY`: Provide your valid OpenAI API key for the intelligence pipeline.
*   `KRYTZ_TOOL_ALLOWED_HOSTS`: Set to your actual domain name.

## 4. Docker Compose Adjustments

You can use the existing `docker-compose.yml`, but for production it is recommended to create a `docker-compose.prod.yml` that:
1.  Removes volume mounts that map to local source code (e.g., `./server/src:/app/server/src`). Instead, build the image and run the compiled code.
2.  Does not expose internal ports like `5544` for Postgres to the host machine, keeping them isolated in the Docker network.
3.  Only exposes the API port (e.g., `8000`) locally so Nginx can proxy to it.

## 5. SSL & Reverse Proxy (Nginx)

1.  Configure Nginx to listen on port 80 and proxy traffic to `http://localhost:8301` (or whatever port the API binds to).
2.  Install `certbot` and run `certbot --nginx -d api.krytz.app` to automatically provision Let's Encrypt SSL certificates.

## 6. Build and Deploy

```bash
# Build the production images
docker-compose -f docker-compose.prod.yml build

# Start the stack
docker-compose -f docker-compose.prod.yml up -d
```

## 7. Client (PWA) Deployment

The Vite React client can be statically built and hosted practically anywhere for free.
1.  Run `npm run build` in the `client/` directory.
2.  Deploy the output `dist/` folder to Vercel, Netlify, or Cloudflare Pages.
3.  Ensure the client is configured to hit your new production API URL (e.g., `VITE_API_BASE_URL=https://api.krytz.app`).

## 8. Backup Strategy

*   **Database**: Set up a nightly cron job on the server to run `pg_dump` and upload the SQL dump to an external S3 bucket.
*   **Object Storage (MinIO)**: Configure MinIO replication or use an external S3 provider (like AWS S3 or Cloudflare R2) if you don't want to self-host file storage long-term.
