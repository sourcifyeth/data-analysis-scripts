# data-analysis-scripts
A repo to collect scripts that provide insights into Sourcify's data.

At the moment the only script that is available is `proxy-analysis.mjs`, which detects proxy contracts in a Sourcify database.

## Installation


```bash
npm install
```


## Configuration

It is necessary to have a `.env` file with the environment variables that can be found in the example `.env.template` file.

Additionally, `multi-proxy-analysis` requires RPC endpoints to resolve implementation addresses. Please create a `rpc-config.json` in the format that the `rpc-config.json.template` shows. The keys are the chain IDs and the values are the RPC URLs. Add an RPC URL for all the chains that you want to analyse.


## Available scripts

### Proxy analysis

```bash
npm run proxy-analysis
```

This script detects proxy contracts in a Sourcify database. It uses the `whatsabi` library to detect proxy contracts by their bytecode. The results from a run on the whole production database of Sourcify on the 6th October 2024 can be found in the `proxy-analysis-results` directory.

### Multi-proxy analysis

```bash
npm run multi-proxy-analysis
```

This script runs on the results of `proxy-analysis`. It makes use of the `proxy-detection-results/multi-proxy-contracts.json` file. It gives the different detected proxy types and how many different implementation addresses they resolve to. The results from a run on the 11th October 2024 can be found in the `multi-proxy-analysis-results` directory.

