import { existsSync } from "node:fs";
import { validateDeploymentEnv } from "./deployment-env.mjs";

if (!process.env.VERCEL && existsSync(".env.local")) process.loadEnvFile(".env.local");
const { errors, warnings } = validateDeploymentEnv(process.env);
for (const warning of warnings) console.warn(`[deployment warning] ${warning}`);
for (const error of errors) console.error(`[deployment error] ${error}`);
if (errors.length) {
  console.error("Fix these settings in Vercel → Project → Settings → Environment Variables, then redeploy. See docs/VERCEL-DEPLOYMENT.md.");
  process.exitCode = 1;
} else console.log("Deployment configuration passed. No database or external service was changed.");
