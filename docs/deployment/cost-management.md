# Cost management

Plan USD 10–30 per active POC month as an estimate. Actual spend depends on provider plans, compute time, memory, storage and egress. Keep a single Railway instance, start with 512 MiB and one vCPU if the available plan supports those controls, and review observed cold-start and benchmark timing. The initial artifact set is small enough for Netlify static hosting. Add object storage after measuring archive growth and egress.

Enable Railway usage alerts and limits where the account supports them. Review Netlify credits and Neon compute/storage separately. Suspend the demo or disable live job tokens if costs exceed the agreed budget. Serving recorded replays avoids waking the backend on page visits. [Railway Serverless](https://docs.railway.com/deployments/serverless)
