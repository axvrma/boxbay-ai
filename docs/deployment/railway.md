# Railway deployment

Use one service on the Hobby plan, sourced from the repository root. The root Dockerfile starts one Uvicorn process and binds the platform's `PORT`. Set the healthcheck path to `/api/v1/ready` and timeout to 90 seconds in the service's Deployment settings. The tracked `railway.toml` provides the same values for legacy Config as Code services. For new services configure the values using the current service settings because Railway is deprecating that file-based integration.

Set `DATABASE_URL`, `BOXBAY_OPERATOR_TOKEN`, `BOXBAY_ADMIN_TOKEN` and `BOXBAY_CORS_ORIGINS=https://boxbay.axvrma.com`. Leave `BOXBAY_LOCAL_OPEN` unset. Restrict production deployment to verified GitHub commits. Generate a service domain, check readiness and configure the Netlify API variable with the HTTPS origin.

Enable Serverless in Railway and redeploy if sleeping is desired. The browser wakes the API on operator actions using bounded backoff. The database connection closes between requests. In-flight job state lives in one instance and requires retry after a restart. [Railway Dockerfiles](https://docs.railway.com/builds/dockerfiles) · [Railway Serverless](https://docs.railway.com/deployments/serverless)
