# data-analysis-scripts
A repo to collect scripts that provide insights into Sourcify's data.

At the moment the only script that is available is `proxy-analysis.mjs`, which detects proxy contracts in a Sourcify database.

## Installation


```bash
npm install
```


## Configuration

It is necessary to have a `.env` file with the environment variables that can be found in the example `.env.template` file.


## Available scripts

### Proxy analysis

```bash
npm run proxy-analysis
```

This script detects proxy contracts in a Sourcify database. It uses the `whatsabi` library to detect proxy contracts by their bytecode. The results from a run on the whole production database of Sourcify on the 6th October 2024 can be found in the `proxy-analysis-results` directory.




