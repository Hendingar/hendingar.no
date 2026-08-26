@description('Short app name, used for resource naming.')
param appName string = 'hendingar'

@description('Environment suffix: dev | prod.')
param env string = 'dev'

param location string = resourceGroup().location

@description('Postgres administrator login.')
param postgresAdminUser string = 'hendingar'

@description('Postgres administrator password. Supplied at deploy time from a GitHub secret — never stored in the repo. See ADR 0007.')
@secure()
param postgresAdminPassword string

@description('Cheapest burstable tier. See ADR 0007 for why this is not serverless.')
param postgresSku string = 'Standard_B1ms'

var suffix = uniqueString(resourceGroup().id)
var acrName = 'acr${appName}${suffix}'
var pgName = 'psql-${appName}-${env}-${suffix}'
var dbName = appName
var tags = {
  project: 'hendingar.no'
  app: appName
  env: env
  iac: 'bicep'
}

// This template is the PLATFORM only — it deliberately does not contain the Container App.
// They used to live together, and because the workflow's first pass omitted the image parameter,
// every deploy re-applied the template's default (a public placeholder image) and rewrote the live
// app to Microsoft's quickstart page for several minutes until the second pass restored it.
// Separating them means a platform converge can never touch what the app is running.

// Runtime workload identity. Referenced by the Container App, and granted AcrPull separately —
// role assignments are deliberately NOT in this template because the CI principal only has
// Contributor on the resource group, and Contributor cannot write role assignments.
resource runtimeIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${appName}'
  location: location
  tags: tags
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    // Pull via managed identity, not shared credentials.
    adminUserEnabled: false
  }
}

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${appName}-${env}'
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: pgName
  location: location
  tags: tags
  sku: {
    name: postgresSku
    tier: 'Burstable'
  }
  properties: {
    version: '17'
    administratorLogin: postgresAdminUser
    administratorLoginPassword: postgresAdminPassword
    storage: {
      storageSizeGB: 32
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      // Burstable does not support HA. Recorded in ADR 0007 as an accepted limitation.
      mode: 'Disabled'
    }
    network: {
      publicNetworkAccess: 'Enabled'
    }
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: dbName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// PostGIS. Allow-listing it is a server parameter, settable with RG Contributor — no Owner needed.
// This is what resolves the open hosting risk in ADR 0005.
resource postgisExtension 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: postgres
  name: 'azure.extensions'
  properties: {
    value: 'POSTGIS'
    source: 'user-override'
  }
  dependsOn: [
    database
  ]
}

// 0.0.0.0–0.0.0.0 is Azure's magic range meaning "allow other Azure services", not "allow the
// internet". Container Apps reaches Postgres through this.
resource allowAzureServices 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: postgres
  name: 'AllowAllAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
  dependsOn: [
    postgisExtension
  ]
}

resource containerEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-${appName}-${env}'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

output acrName string = acr.name
output acrLoginServer string = acr.properties.loginServer
output postgresFqdn string = postgres.properties.fullyQualifiedDomainName
output postgresAdminUserOut string = postgresAdminUser
output managedEnvironmentId string = containerEnv.id
output runtimeIdentityId string = runtimeIdentity.id
output runtimeIdentityPrincipalId string = runtimeIdentity.properties.principalId
