import express from "express";
import dotenv from "dotenv";
import axios from "axios";
import { DefaultAzureCredential } from "@azure/identity";
import { ResourceManagementClient } from "@azure/arm-resources";

dotenv.config();

const app = express();
app.use(express.json());

const port = 3000;

// Azure setup
const credential = new DefaultAzureCredential();
const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;

const resourceClient = new ResourceManagementClient(credential, subscriptionId);

const staticWebAppType = "Microsoft.Web/staticSites";
const staticWebAppApiVersion = "2022-09-01";

async function findStaticWebApp(rg, name) {
  for await (const r of resourceClient.resources.listByResourceGroup(rg)) {
    if (r.type?.toLowerCase() === staticWebAppType.toLowerCase() && r.name === name) {
      if (!r.id) {
        return r;
      }

      return resourceClient.resources.getById(r.id, staticWebAppApiVersion);
    }
  }

  return null;
}

function getStaticWebAppUrl(app) {
  const hostname =
    app?.properties?.defaultHostname ||
    app?.properties?.defaultHostName ||
    app?.properties?.hostName;

  if (hostname) {
    return hostname.startsWith("http") ? hostname : `https://${hostname}`;
  }

  return `https://${app.name}.azurestaticapps.net`;
}


// =====================
// 1. List Resource Groups
// =====================
app.get("/resource-groups", async (req, res) => {
  try {
    const groups = [];
    for await (const g of resourceClient.resourceGroups.list()) {
      groups.push(g.name);
    }
    res.json(groups);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// =====================
// 2. List Resources in RG
// =====================
app.get("/resources/:rg", async (req, res) => {
  try {
    const rg = decodeURIComponent(req.params.rg);
    const resources = [];

    for await (const r of resourceClient.resources.listByResourceGroup(rg)) {
      resources.push({
        name: r.name,
        type: r.type
      });
    }

    res.json(resources);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// =====================
// 3. Static Web Apps in RG
// =====================
app.get("/static-webapps/:rg", async (req, res) => {
  try {
    const rg = decodeURIComponent(req.params.rg);
    const apps = [];

    for await (const r of resourceClient.resources.listByResourceGroup(rg)) {
      if (r.type === staticWebAppType) {
        apps.push({
          name: r.name,
          location: r.location,
          id: r.id,
          url: getStaticWebAppUrl(r)
        });
      }
    }

    res.json(apps);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// =====================
// 4. Static Web App Detail
// =====================
app.get("/static-webapp-detail/:rg/:name", async (req, res) => {
  try {
    const rg = decodeURIComponent(req.params.rg);
    const name = decodeURIComponent(req.params.name);

    const app = await findStaticWebApp(rg, name);

    if (app) {
      return res.json({
        name: app.name,
        location: app.location,
        id: app.id,
        type: app.type,
        url: getStaticWebAppUrl(app),
        properties: app.properties
      });
    }

    res.status(404).json({ error: "Static Web App not found", rg, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// =====================
// 5. Static Web App URL
// =====================
app.get("/static-webapp-url/:rg/:name", async (req, res) => {
  try {
    const rg = decodeURIComponent(req.params.rg);
    const name = decodeURIComponent(req.params.name);
    const app = await findStaticWebApp(rg, name);

    if (!app) {
      return res.status(404).json({ error: "Static Web App not found", rg, name });
    }

    const url = getStaticWebAppUrl(app);

    res.json({ name, url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// =====================
// 6. Static Web App Health Check (FINAL FIX)
// =====================
app.get("/static-webapp-health/:rg/:name", async (req, res) => {
  let url;

  try {
    const rg = decodeURIComponent(req.params.rg);
    const name = decodeURIComponent(req.params.name);
    const app = await findStaticWebApp(rg, name);

    if (!app) {
      return res.status(404).json({ error: "Static Web App not found", rg, name, ok: false });
    }

    url = getStaticWebAppUrl(app);

    console.log("Checking URL:", url);

    const response = await axios.get(url, {
      maxRedirects: 5,
      validateStatus: () => true
    });

    res.json({
      url,
      status: response.status,
      ok: response.status >= 200 && response.status < 300
    });

  } catch (err) {
    res.status(500).json({
      url,
      ok: false,
      error: err.message
    });
  }
});


// =====================
// START SERVER
// =====================
app.listen(port, () => {
  console.log(`MCP running on http://localhost:${port}`);
});
