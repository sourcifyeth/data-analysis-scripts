// Takes the result of proxy-analysis.mjs and analyses the multi-proxy contracts
import fs from "fs/promises";
import path from "path";
import pg from "pg";
import dotenv from "dotenv";
import { JsonRpcProvider } from "ethers";
import process from "process";
import { fileURLToPath } from "url";
import { whatsabi } from "@shazow/whatsabi";

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: process.env.POSTGRES_PORT,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
});

const PROXY_RESULT_FOLDER = "proxy-detection-results";
const MULTI_PROXY_RESULT_FOLDER = "multi-proxy-analysis-results";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
async function writeJsonFile(filename, data) {
  const outputPath = path.join(__dirname, MULTI_PROXY_RESULT_FOLDER, filename);
  try {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(data, null, 2));
    console.log(`Data written to ${outputPath}`);
  } catch (writeError) {
    console.error("Error writing to file:", writeError);
  }
}

const getStringFromResolverList = (proxyResolverList) => {
  return proxyResolverList.map((resolver) => resolver.name).join(", ");
};

async function checkMultiProxies() {
  const multiProxyContractsPath = path.join(
    __dirname,
    PROXY_RESULT_FOLDER,
    "multi-proxy-contracts.json"
  );
  const multiProxyContracts = JSON.parse(
    await fs.readFile(multiProxyContractsPath, "utf8")
  );

  const rpcConfigPath = path.join(__dirname, "rpc-config.json");
  const rpcConfig = JSON.parse(await fs.readFile(rpcConfigPath, "utf8"));

  const client = await pool.connect();

  let processedContracts = 0;
  const checkedChains = [];
  const multiProxyContractTypes = {};
  const numberOfImplementationAddressesCount = {};
  const multiImplementationAddresses = {};

  const printResults = async () => {
    console.log("Processed contracts: ", processedContracts);
    console.log("Checked chains: ", checkedChains);
    console.log("Multi proxy contract types: ", multiProxyContractTypes);
    console.log(
      "Number of implementation addresses count: ",
      numberOfImplementationAddressesCount
    );

    const result = {
      processedContracts,
      checkedChains,
      numberOfImplementationAddressesCount,
      multiProxyContractTypes,
    };
    await writeJsonFile("result.json", result);
    await writeJsonFile(
      "multi-implementation-addresses.json",
      multiImplementationAddresses
    );
  };
  process.on("SIGINT", async () => {
    await printResults();
    process.exit(0);
  });

  try {
    for (const chainId of Object.keys(multiProxyContracts)) {
      if (!rpcConfig[chainId]) {
        console.warn(`No RPC URL for chain id ${chainId}`);
        continue;
      }
      const provider = new JsonRpcProvider(rpcConfig[chainId]);
      console.log(provider.connection);
      console.log(provider.connect);
      console.log("Processing chain id ", chainId);
      checkedChains.push(chainId);

      for (const address of multiProxyContracts[chainId]) {
        const queryResult = await client.query(
          `
            SELECT
              encode(code.code, 'hex') as code
            FROM sourcify_matches
              JOIN verified_contracts ON verified_contracts.id = sourcify_matches.verified_contract_id
              JOIN contract_deployments ON contract_deployments.id = verified_contracts.deployment_id
              JOIN contracts ON contracts.id = contract_deployments.contract_id
              JOIN code on code.code_hash = contracts.runtime_code_hash
            WHERE decode($1, 'hex') = contract_deployments.address
              AND contract_deployments.chain_id = $2
          `,
          [address.substring(2), chainId]
        );

        if (queryResult.rows.length > 1) {
          throw new Error(
            `Multiple contracts found for address ${address} and chain id ${chainId}`
          );
        }

        processedContracts++;

        const row = queryResult.rows[0];

        // Proxy detection
        const codeCache = {
          [address]: row.code,
        };
        const cachedCodeProvider = whatsabi.providers.WithCachedCode(
          provider,
          codeCache
        );
        const whatsabiResult = await whatsabi.autoload(address, {
          provider: cachedCodeProvider,
          abiLoader: false,
          signatureLookup: false,
          followProxies: false,
        });

        if (whatsabiResult.proxies.length < 2) {
          console.warn(
            `Just ${whatsabiResult.proxies.length} proxies found for address ${address} on chain ${chainId}`
          );
          continue;
        }

        const resolverListString = getStringFromResolverList(
          whatsabiResult.proxies
        );
        if (!multiProxyContractTypes[resolverListString]) {
          multiProxyContractTypes[resolverListString] = 0;
        }
        multiProxyContractTypes[resolverListString]++;

        const implementations = new Set();
        for (const proxy of whatsabiResult.proxies) {
          const implementation = await proxy.resolve(provider, address);
          implementations.add(implementation);
        }

        if (!numberOfImplementationAddressesCount[implementations.size]) {
          numberOfImplementationAddressesCount[implementations.size] = 0;
        }
        numberOfImplementationAddressesCount[implementations.size]++;

        if (implementations.size > 1) {
          if (!multiImplementationAddresses[chainId]) {
            multiImplementationAddresses[chainId] = {};
          }
          multiImplementationAddresses[chainId][address] =
            Array.from(implementations);
        }
      }
    }

    // Done
  } catch (error) {
    console.error("Error checking multi proxies: ", error);
  } finally {
    client.release();
    await printResults();
  }
}

checkMultiProxies()
  .then(() => {
    console.log("Completed");
  })
  .catch((error) => {
    console.error("Error in checkMultiProxies: ", error);
  })
  .finally(() => {
    pool.end();
  });
