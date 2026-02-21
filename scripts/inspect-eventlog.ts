import { fmLogin, fmLogout } from "../src/filemaker-client.js";
import { buildDataApiBaseUrl } from "../src/utils.js";
import type { FileMakerIdPConfig } from "../src/types.js";

const serviceUsername = process.env.FM_IdP_SERVICE_USERNAME;
const servicePassword = process.env.FM_IdP_SERVICE_PASSWORD;
if (!serviceUsername || !servicePassword) {
  throw new Error("FM_IdP_SERVICE_USERNAME and FM_IdP_SERVICE_PASSWORD must be set");
}

const config: FileMakerIdPConfig = {
  host: process.env.FM_IdP_HOST ?? "db.research-allies.cloud",
  database: process.env.FM_IdP_DATABASE ?? "IdP_Accounts.fmp12",
  useHttps: true,
  serviceUsername, servicePassword, userLayout: "DAPI_USER", timeout: 10000,
  fields: { idUserField:"id_user", usernameField:"userName", nameFirstField:"nameFirst", nameLastField:"nameLast", emailField:"email", portalName:"userProjectRole", projectIdField:"project::id_project", projectNameField:"project::projectName", roleNameField:"role::roleName" },
};

async function tryPost(token: string, fieldData: Record<string, string>) {
  const baseUrl = buildDataApiBaseUrl(config);
  const res = await fetch(`${baseUrl}/layouts/DAPI_EVENTLOG/records`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fieldData }),
  });
  const data = await res.json() as any;
  return { status: res.status, code: data?.messages?.[0]?.code, msg: data?.messages?.[0]?.message };
}

async function run() {
  const token = await fmLogin(config, config.serviceUsername, config.servicePassword);
  try {
    for (const field of ["Application_Version", "Device"]) {
      const r = await tryPost(token, { [field]: "test" });
      console.log(`${field}: HTTP ${r.status} — ${r.code} ${r.msg}`);
    }
  } finally {
    void fmLogout(config, token);
  }
}
run().catch(err => { console.error(err); process.exit(1); });
