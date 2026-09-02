// ai.bicep — the one place a language model is reachable from.
//
// Entra-only: `disableLocalAuth` means there is no API key to leak, rotate or accidentally commit.
// The verifier authenticates with its user-assigned managed identity and mints a token per call.
// Adapted from nnext-agents/infra/modules/openai.bicep, which is the house pattern.

@description('Short app name, used for resource naming.')
param appName string

param location string
param tags object

@description('Suffix for the globally-unique account name.')
param nameSuffix string

@description('Deployment name — what the service sends as AZURE_OPENAI_CHAT_MODEL. Not a catalogue model id.')
param deploymentName string = 'gpt-4.1-mini'

@description('Pinned model version. gpt-4.1-mini reads images, which is what poster extraction needs.')
param modelVersion string = '2025-04-14'

@description('Capacity in thousands of tokens per minute. Poster reads are small and bursty.')
param capacity int = 20

resource account 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: 'aoai-${appName}-${nameSuffix}'
  location: location
  tags: tags
  kind: 'OpenAI'
  sku: {
    name: 'S0'
  }
  properties: {
    // Required before Entra token auth works at all.
    customSubDomainName: 'aoai-${appName}-${nameSuffix}'
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
  }
}

// SKU 'Standard' = single-region processing: strongest EU data residency, and the only SKU with
// quota in the sponsorship subscription (DataZoneStandard quota is 0 there).
resource deployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: account
  name: deploymentName
  sku: {
    name: 'Standard'
    capacity: capacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-4.1-mini'
      version: modelVersion
    }
    // Pinned deliberately. A silent upgrade would change extraction behaviour with no commit.
    versionUpgradeOption: 'NoAutoUpgrade'
  }
}

output endpoint string = account.properties.endpoint
output accountName string = account.name
output deploymentName string = deployment.name
