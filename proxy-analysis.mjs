import pg from "pg";
import dotenv from "dotenv";
import { whatsabi } from "@shazow/whatsabi";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const RESULT_FOLDER = "proxy-detection-results";

const { Pool } = pg;

const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: process.env.POSTGRES_PORT,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
});

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || "1000");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
async function writeJsonFile(filename, data) {
  const outputPath = path.join(__dirname, RESULT_FOLDER, filename);
  try {
    await fs.writeFile(outputPath, JSON.stringify(data, null, 2));
    console.log(`Data written to ${outputPath}`);
  } catch (writeError) {
    console.error("Error writing to file:", writeError);
  }
}

function calculateMedian(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const middleIndex = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middleIndex - 1] + sorted[middleIndex]) / 2
    : sorted[middleIndex];
}

async function checkProxies() {
  const client = await pool.connect();

  try {
    let processedRows = 0;
    let totalRows = 0;
    let proxyCount = 0;
    const proxyTypes = {};
    const multiProxyContractsCount = {};
    const multiProxyContracts = {};
    const durations = [];

    do {
      // Fetch a batch of rows
      const queryResult = await client.query(
        `
        SELECT
          sourcify_matches.created_at,
          sourcify_matches.creation_match,
          sourcify_matches.runtime_match,
          CONCAT('0x', encode(contract_deployments.address, 'hex')) as address,
          encode(code.code, 'hex') as code,
          contract_deployments.chain_id
        FROM sourcify_matches
          JOIN verified_contracts ON verified_contracts.id = sourcify_matches.verified_contract_id
          JOIN contract_deployments ON contract_deployments.id = verified_contracts.deployment_id
          JOIN contracts ON contracts.id = contract_deployments.contract_id
          JOIN code on code.code_hash = contracts.runtime_code_hash
        OFFSET $1
        LIMIT $2
      `,
        [processedRows, BATCH_SIZE]
      );

      totalRows = queryResult.rows.length;

      if (totalRows > 0) {
        const anyProvider = {
          request: () => {},
        };

        const codeCache = queryResult.rows.reduce((acc, row) => {
          acc[row.address] = row.code;
          return acc;
        }, {});

        const cachedCodeProvider = whatsabi.providers.WithCachedCode(
          anyProvider,
          codeCache
        );

        for (const row of queryResult.rows) {
          const start = performance.now();
          const whatsabiResult = await whatsabi.autoload(row.address, {
            provider: cachedCodeProvider,
            abiLoader: false,
            signatureLookup: false,
            followProxies: false,
          });
          const end = performance.now();
          durations.push(end - start);

          if (whatsabiResult.proxies.length > 0) {
            proxyCount++;
          }

          if (whatsabiResult.proxies.length > 1) {
            if (!multiProxyContractsCount[whatsabiResult.proxies.length]) {
              multiProxyContractsCount[whatsabiResult.proxies.length] = 0;
            }
            if (!multiProxyContracts[row.chain_id]) {
              multiProxyContracts[row.chain_id] = [];
            }

            multiProxyContractsCount[whatsabiResult.proxies.length]++;
            multiProxyContracts[row.chain_id].push(row.address);
          }

          for (const proxy of whatsabiResult.proxies) {
            if (!proxyTypes[proxy.name]) {
              proxyTypes[proxy.name] = 0;
            }
            proxyTypes[proxy.name]++;
          }
        }

        processedRows += totalRows;
        console.log(`Processed ${processedRows} rows`);
      }
    } while (totalRows === BATCH_SIZE);

    console.log(`Finished processing ${processedRows} rows in total`);

    console.log(
      "Average detection duration: ",
      durations.reduce((a, b) => a + b, 0) / durations.length,
      " ms"
    );
    console.log("Total proxies: ", proxyCount);
    console.log("Proxy types by name: ", proxyTypes);
    console.log(
      "Contracts with multiple proxies detected: ",
      multiProxyContractsCount
    );

    const resultData = {
      analyzedContracts: processedRows,
      proxyCount,
      proxyTypes,
      multiProxyContractsCount,
    };
    await writeJsonFile("results.json", resultData);

    await writeJsonFile("multi-proxy-contracts.json", multiProxyContracts);

    const durationData = {
      averageDurationMs:
        durations.reduce((a, b) => a + b, 0) / durations.length,
      minDurationMs: durations.reduce((a, b) => (a < b ? a : b), durations[0]),
      maxDurationMs: durations.reduce((a, b) => (a > b ? a : b), durations[0]),
      medianDurationMs: calculateMedian(durations),
    };
    await writeJsonFile("durations-stats.json", durationData);
  } catch (error) {
    console.error("Error checking proxies: ", error);
  } finally {
    client.release();
  }
}

checkProxies()
  .then(() => {
    console.log("Completed");
  })
  .catch((error) => {
    console.error("Error in checkProxies: ", error);
  })
  .finally(() => {
    pool.end();
  });
